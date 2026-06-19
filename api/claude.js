export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
    return;
  }

  const { messages, system } = req.body || {};
  if (!messages || !messages[0]) {
    res.status(400).json({ error: "Missing messages" });
    return;
  }

  // This app only ever sends a single user turn, so just grab its text.
  const userText = messages[0].content;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: system ? { parts: [{ text: system }] } : undefined,
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: { maxOutputTokens: 4000 },
        }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      res.status(geminiRes.status).json({ error: data.error?.message || "Gemini request failed" });
      return;
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    // Reshape into the same {content:[{type:"text", text}]} shape the frontend expects.
    res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    res.status(500).json({ error: "Upstream request failed", detail: String(err) });
  }
}
