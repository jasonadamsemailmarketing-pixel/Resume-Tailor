import React, { useState, useEffect, useRef } from "react";

const ACCENT = "#3b7ef8";
const GOLD = "#f59e0b";
const INK = "#0b1120";

function callClaude(messages, system) {
  return fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system }),
  }).then((r) => r.json());
}

function extractText(data) {
  if (!data || !data.content) return "";
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function stripFence(text) {
  return text.replace(/```json|```/g, "").trim();
}

let mammothLoadPromise = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (mammothLoadPromise) return mammothLoadPromise;
  mammothLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
    script.onload = () => resolve(window.mammoth);
    script.onerror = () => reject(new Error("mammoth failed to load"));
    document.head.appendChild(script);
  });
  return mammothLoadPromise;
}

let pdfjsLoadPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoadPromise) return pdfjsLoadPromise;
  pdfjsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("pdf.js failed to load"));
    document.head.appendChild(script);
  });
  return pdfjsLoadPromise;
}

async function extractPdfText(arrayBuffer) {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n\n";
  }
  return text.trim();
}

export default function ResumeTailor() {
  const [stage, setStage] = useState("loading"); // loading | setup | ready
  const [resumeText, setResumeText] = useState("");
  const [resumeDraft, setResumeDraft] = useState("");
  const [jobInput, setJobInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [keywords, setKeywords] = useState(null); // {must, nice}
  const [tailored, setTailored] = useState("");
  const [matchNotes, setMatchNotes] = useState("");
  const [error, setError] = useState("");
  const [parsingFile, setParsingFile] = useState(false);
  const [view, setView] = useState("tailored"); // tailored | original
  const fileRef = useRef(null);
  const jdFileRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("master-resume");
      if (saved) {
        setResumeText(saved);
        setStage("ready");
      } else {
        setStage("setup");
      }
    } catch {
      setStage("setup");
    }
  }, []);

  async function saveResume() {
    if (!resumeDraft.trim()) return;
    try {
      localStorage.setItem("master-resume", resumeDraft);
      setResumeText(resumeDraft);
      setStage("ready");
    } catch {
      setError("Couldn't save your resume. Try again.");
    }
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setParsingFile(true);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".txt") || name.endsWith(".md")) {
        const text = await file.text();
        setResumeDraft(text);
      } else if (name.endsWith(".docx")) {
        const buf = await file.arrayBuffer();
        const mammothLib = await loadMammoth();
        const result = await mammothLib.extractRawText({ arrayBuffer: buf });
        setResumeDraft(result.value.trim());
      } else if (name.endsWith(".pdf")) {
        const buf = await file.arrayBuffer();
        const text = await extractPdfText(buf);
        if (!text || text.length < 30) {
          setError("Couldn't read text from that PDF (it may be a scanned image). Try a .docx/.txt export, or paste the text directly.");
        } else {
          setResumeDraft(text);
        }
      } else if (name.endsWith(".doc")) {
        setError("Old .doc format isn't supported — please save/export as .docx, .pdf, or .txt and upload that.");
      } else if (name.endsWith(".gdoc")) {
        setError("That's a Google Docs shortcut file, not the document itself. In Google Docs, use File → Download → Word (.docx) or PDF, then upload that file.");
      } else {
        setError("Unsupported file type. Upload a .pdf, .docx, .txt, or .md file.");
      }
    } catch (err) {
      setError("Couldn't read that file. Try re-exporting it as .docx or .pdf, or paste your resume text directly.");
    } finally {
      setParsingFile(false);
      e.target.value = "";
    }
  }

  async function handleJdFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setParsingFile(true);
    try {
      const name = file.name.toLowerCase();
      let text = "";
      if (name.endsWith(".txt") || name.endsWith(".md")) {
        text = await file.text();
      } else if (name.endsWith(".docx")) {
        const buf = await file.arrayBuffer();
        const mammothLib = await loadMammoth();
        const result = await mammothLib.extractRawText({ arrayBuffer: buf });
        text = result.value.trim();
      } else if (name.endsWith(".pdf")) {
        const buf = await file.arrayBuffer();
        text = await extractPdfText(buf);
      } else if (name.endsWith(".doc")) {
        setError("Old .doc format isn't supported — export as .docx or .pdf instead.");
      } else {
        setError("Unsupported file type. Upload a .pdf, .docx, .txt, or .md file.");
      }
      if (text) setJobInput(text);
    } catch {
      setError("Couldn't read that file. Try .docx or .pdf, or paste the job text directly.");
    } finally {
      setParsingFile(false);
      e.target.value = "";
    }
  }

  async function analyze() {
    setError("");
    if (!jobInput.trim()) return;
    setAnalyzing(true);
    setKeywords(null);
    setTailored("");
    setMatchNotes("");
    try {
      let jdText = jobInput.trim();
      const isUrl = /^https?:\/\//i.test(jdText);
      if (isUrl) {
        try {
          const r = await fetch(jdText);
          const html = await r.text();
          const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (stripped.length > 200) {
            jdText = stripped.slice(0, 12000);
          } else {
            throw new Error("empty");
          }
        } catch {
          setError("Couldn't fetch that link directly (many job sites block this). Paste the job description text instead.");
          setAnalyzing(false);
          return;
        }
      }

      // Step 1: extract keywords
      const kwSystem =
        "You are a precise ATS keyword extraction engine. Output ONLY valid JSON, no preamble, no markdown fences.";
      const kwPrompt = `Read this job description and extract the keywords/phrases an ATS or recruiter would scan for.

Job description:
"""${jdText}"""

Return JSON exactly in this shape:
{"job_title":"...","must_have":["...up to 12 hard requirements: tools, platforms, certifications, hard skills, years of experience"],"nice_to_have":["...up to 8 secondary skills, soft skills, or preferred qualifications"],"top_phrases":["...up to 6 exact recurring phrases from the posting worth mirroring verbatim"]}`;

      const kwRes = await callClaude(
        [{ role: "user", content: kwPrompt }],
        kwSystem
      );
      const kwParsed = JSON.parse(stripFence(extractText(kwRes)));
      setKeywords(kwParsed);

      // Step 2: tailor resume
      const tailorSystem =
        "You are an expert resume writer who tailors resumes to job descriptions using truthful keyword alignment. Never invent experience, employers, titles, dates, or metrics that aren't in the original resume. You may rephrase, reorder, re-emphasize, and surface relevant existing experience using the job's terminology.";
      const tailorPrompt = `Here is the candidate's master resume:
"""${resumeText}"""

Here is the target job description:
"""${jdText}"""

Extracted keywords to weave in naturally (only where truthfully applicable): ${JSON.stringify(kwParsed)}

Rewrite the resume tailored to this job. Rules:
- Keep it truthful: do not fabricate employers, titles, dates, certifications, or numbers.
- Reorder/re-emphasize bullets so the most relevant experience leads.
- Mirror the job description's terminology where the candidate's real experience genuinely matches.
- Keep the same overall structure/sections as the original resume.
- Keep formatting as clean plain text (use line breaks, dashes, and capitalized section headers — no markdown asterisks).
- After the resume, add a line "---MATCH NOTES---" followed by a short 3-5 bullet list explaining which keywords were emphasized and any must-have keywords from the job that the candidate's resume does NOT currently support (so they know what's missing, don't hide gaps).

Output the tailored resume text, then the ---MATCH NOTES--- section. Nothing else.`;

      const tailorRes = await callClaude(
        [{ role: "user", content: tailorPrompt }],
        tailorSystem
      );
      const fullText = extractText(tailorRes);
      const splitIdx = fullText.indexOf("---MATCH NOTES---");
      if (splitIdx >= 0) {
        setTailored(fullText.slice(0, splitIdx).trim());
        setMatchNotes(fullText.slice(splitIdx + "---MATCH NOTES---".length).trim());
      } else {
        setTailored(fullText.trim());
      }
      setView("tailored");
    } catch (e) {
      setError("Something went wrong analyzing or tailoring. Try again, or paste the job text instead of a link.");
    } finally {
      setAnalyzing(false);
    }
  }

  function download(text, filename) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
  }

  async function resetResume() {
    setStage("setup");
    setResumeDraft(resumeText);
  }

  // ---------- RENDER ----------

  if (stage === "loading") {
    return (
      <div style={{ ...wrap, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#94a3b8", fontFamily: "Georgia, serif" }}>Loading…</div>
      </div>
    );
  }

  if (stage === "setup") {
    return (
      <div style={wrap}>
        <Header />
        <div style={{ padding: "24px 28px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
          <div style={eyebrow}>STEP 1 — MASTER RESUME</div>
          <h2 style={h2}>Save your base resume once.</h2>
          <p style={{ color: "#94a3b8", marginBottom: 20, lineHeight: 1.6 }}>
            Paste your resume text below, or upload a .txt/.md file. This becomes the source
            material every tailored version is built from — stored on this device, ready whenever
            you have a new job to target.
          </p>
          <textarea
            value={resumeDraft}
            onChange={(e) => setResumeDraft(e.target.value)}
            placeholder="Paste your full resume text here..."
            style={textarea}
          />
          <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ ...btnGhost, opacity: parsingFile ? 0.5 : 1, position: "relative", overflow: "hidden" }}>
              {parsingFile ? "Reading file…" : "Upload PDF / Word / .txt"}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md"
                style={overlayInput}
                onChange={handleFile}
                disabled={parsingFile}
              />
            </label>
            <button
              style={{ ...btnPrimary, opacity: resumeDraft.trim() ? 1 : 0.4 }}
              disabled={!resumeDraft.trim()}
              onClick={saveResume}
            >
              Save resume
            </button>
          </div>
          {error && <div style={errorBox}>{error}</div>}
          <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
            Using Google Docs? Open it, then File → Download → Word (.docx) or PDF, and upload that file here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <Header />
      <div style={{ padding: "24px 28px", maxWidth: 920, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={eyebrow}>STEP 2 — TARGET JOB</div>
            <h2 style={h2}>Paste a job link or description.</h2>
          </div>
          <button style={btnGhost} onClick={resetResume}>
            Edit master resume
          </button>
        </div>

        <textarea
          value={jobInput}
          onChange={(e) => setJobInput(e.target.value)}
          placeholder="Paste a job posting URL, or paste the full job description text..."
          style={{ ...textarea, minHeight: 140 }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <label style={{ ...btnGhost, opacity: parsingFile ? 0.5 : 1, position: "relative", overflow: "hidden" }}>
            {parsingFile ? "Reading file…" : "Or upload job posting (PDF/Word/.txt)"}
            <input
              ref={jdFileRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md"
              style={overlayInput}
              onChange={handleJdFile}
              disabled={parsingFile}
            />
          </label>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
          Note: some job sites block automated link fetching. If a link fails, paste the description
          text or upload it as a file instead.
        </div>

        <button
          style={{ ...btnPrimary, marginTop: 14, opacity: jobInput.trim() && !analyzing ? 1 : 0.4 }}
          disabled={!jobInput.trim() || analyzing}
          onClick={analyze}
        >
          {analyzing ? "Analyzing & tailoring…" : "Analyze & tailor resume"}
        </button>

        {error && <div style={errorBox}>{error}</div>}

        {keywords && (
          <div style={{ marginTop: 28 }}>
            <div style={eyebrow}>KEYWORDS DETECTED</div>
            {keywords.job_title && (
              <div style={{ color: "#e2e8f0", fontFamily: "Georgia, serif", fontSize: 17, marginBottom: 10 }}>
                {keywords.job_title}
              </div>
            )}
            <KeywordRow label="Must-have" items={keywords.must_have} color={GOLD} />
            <KeywordRow label="Nice-to-have" items={keywords.nice_to_have} color={ACCENT} />
          </div>
        )}

        {tailored && (
          <div style={{ marginTop: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={eyebrow}>STEP 3 — TAILORED RESUME</div>
              <div style={{ display: "flex", gap: 8 }}>
                <ToggleBtn active={view === "tailored"} onClick={() => setView("tailored")}>
                  Tailored
                </ToggleBtn>
                <ToggleBtn active={view === "original"} onClick={() => setView("original")}>
                  Original
                </ToggleBtn>
              </div>
            </div>

            <pre style={resumeView}>{view === "tailored" ? tailored : resumeText}</pre>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button
                style={btnPrimary}
                onClick={() => download(tailored, "tailored-resume.txt")}
              >
                Download tailored resume (.txt)
              </button>
              <button style={btnGhost} onClick={() => copyToClipboard(tailored)}>
                Copy to clipboard
              </button>
            </div>

            {matchNotes && (
              <div style={{ marginTop: 22 }}>
                <div style={eyebrow}>MATCH NOTES</div>
                <pre style={notesView}>{matchNotes}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ borderBottom: "1px solid #1e293b", padding: "18px 28px" }}>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3 }}>
        Resume Tailor
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
        Keyword-matched resume rewriting, built on your own experience
      </div>
    </div>
  );
}

function KeywordRow({ label, items, color }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((kw, i) => (
          <span
            key={i}
            style={{
              fontSize: 13,
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${color}55`,
              color: color,
              background: `${color}14`,
            }}
          >
            {kw}
          </span>
        ))}
      </div>
    </div>
  );
}

function ToggleBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: "6px 12px",
        borderRadius: 6,
        border: `1px solid ${active ? ACCENT : "#334155"}`,
        background: active ? `${ACCENT}22` : "transparent",
        color: active ? "#e2e8f0" : "#94a3b8",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

const wrap = {
  display: "flex",
  flexDirection: "column",
  minHeight: "100vh",
  background: INK,
  fontFamily: "-apple-system, Segoe UI, sans-serif",
};

const eyebrow = {
  fontSize: 11,
  letterSpacing: 1.5,
  color: "#475569",
  fontWeight: 600,
  marginBottom: 6,
};

const h2 = {
  fontFamily: "Georgia, serif",
  fontSize: 24,
  color: "#e2e8f0",
  margin: "0 0 8px 0",
  fontWeight: 400,
};

const textarea = {
  width: "100%",
  minHeight: 260,
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  color: "#e2e8f0",
  padding: 14,
  fontSize: 14,
  fontFamily: "ui-monospace, monospace",
  lineHeight: 1.6,
  resize: "vertical",
  boxSizing: "border-box",
};

const btnPrimary = {
  background: ACCENT,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const btnGhost = {
  background: "transparent",
  color: "#94a3b8",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
};

const overlayInput = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  opacity: 0,
  cursor: "pointer",
};

const errorBox = {
  marginTop: 14,
  padding: "10px 14px",
  background: "#7f1d1d22",
  border: "1px solid #7f1d1d",
  borderRadius: 8,
  color: "#fca5a5",
  fontSize: 13,
};

const resumeView = {
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  padding: 18,
  color: "#e2e8f0",
  fontSize: 13.5,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  fontFamily: "ui-monospace, monospace",
  marginTop: 12,
  maxHeight: 600,
  overflowY: "auto",
};

const notesView = {
  background: "#f59e0b0d",
  border: "1px solid #f59e0b33",
  borderRadius: 8,
  padding: 16,
  color: "#fbbf24",
  fontSize: 13,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  fontFamily: "Georgia, serif",
};
