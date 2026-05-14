const WEEKDAYS = ["월", "화", "수", "목", "금"];

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map((t) => ({
      day: typeof t.day === "string" ? t.day.trim() : "",
      task: typeof t.task === "string" ? t.task.trim() : "",
      details: Array.isArray(t.details) ? t.details.map((d) => String(d).trim()).filter(Boolean) : []
    }))
    .filter((t) => WEEKDAYS.includes(t.day) && t.task);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const fileName = body.fileName || "weekly-plan.pdf";
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    res.status(400).json({ error: "No PDF lines provided." });
    return;
  }

  const prompt = [
    "You are parsing Korean teacher weekly task PDFs.",
    `File: ${fileName}`,
    "Rules:",
    "1) A row beginning with weekday + date like '월 11' indicates the day block.",
    "2) The symbol '❍' starts a task.",
    "3) Following lines like '-시간', '-기간', '-담당' belong to that task as details.",
    "4) Output STRICT JSON only: {\"tasks\":[{\"day\":\"월|화|수|목|금\",\"task\":\"...\",\"details\":[\"...\"]}]}",
    "5) Do not include explanations.",
    "",
    "PDF lines:",
    ...lines
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: `Gemini API error: ${errText}` });
      return;
    }

    const data = await response.json();
    const modelText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonPayload = extractJson(modelText);
    if (!jsonPayload) {
      res.status(502).json({ error: "Gemini response did not contain valid JSON." });
      return;
    }

    const parsed = JSON.parse(jsonPayload);
    const tasks = normalizeTasks(parsed.tasks);
    res.status(200).json({ tasks });
  } catch (error) {
    res.status(500).json({ error: error.message || "Server error while parsing PDF." });
  }
};
