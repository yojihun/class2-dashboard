const WEEKDAY_SET = new Set(["월", "화", "수", "목", "금"]);

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function normalizeDay(day) {
  const value = String(day || "").trim();
  if (!value) return "";
  if (value.startsWith("월")) return "월";
  if (value.startsWith("화")) return "화";
  if (value.startsWith("수")) return "수";
  if (value.startsWith("목")) return "목";
  if (value.startsWith("금")) return "금";
  return "";
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map((task) => {
      const day = normalizeDay(task.day);
      const title = String(task.task || "").trim();
      const details = Array.isArray(task.details)
        ? task.details.map((d) => String(d).trim()).filter(Boolean)
        : [];
      return { day, task: title, details };
    })
    .filter((t) => WEEKDAY_SET.has(t.day) && t.task.length > 0);
}

function isLikelyDetailLine(text) {
  const line = String(text || "").trim();
  if (!line) return true;
  if (/^[-–—]\s*/.test(line)) return true;
  if (/^(시간|기간|담당|대상|장소|참석|내용)\s*[:：]/.test(line)) return true;
  if (/^\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/.test(line)) return true;
  if (/^\d{1,2}:\d{2}\s*~/.test(line)) return true;
  return false;
}

function cleanAndMergeTasks(tasks) {
  const result = [];
  for (const raw of tasks) {
    const task = {
      day: raw.day,
      task: String(raw.task || "").trim(),
      details: Array.isArray(raw.details) ? raw.details.slice() : []
    };
    if (!task.task) continue;

    if (isLikelyDetailLine(task.task) && result.length > 0 && result[result.length - 1].day === task.day) {
      result[result.length - 1].details.push(task.task.replace(/^[-–—]\s*/, ""));
      result[result.length - 1].details.push(...task.details);
      continue;
    }

    result.push(task);
  }
  return result;
}

function buildPrompt(fileName, lines) {
  return [
    "You are an expert parser for Korean school weekly task PDFs.",
    `File name: ${fileName}`,
    "",
    "Goal:",
    "Convert the whole document into a clean list of tasks by weekday (월~금).",
    "",
    "Important structure rules from this document type:",
    "1) A task starts with the bullet symbol '❍'.",
    "2) One line can contain multiple tasks: e.g. '❍A❍B'. Split them into separate tasks.",
    "3) Detail lines after a task (usually starting with '-') belong to the latest task.",
    "4) Some task titles wrap to the next line without a bullet. Attach wrapped lines to the previous task.",
    "5) Week/day block markers may appear as special symbols or standalone date numbers. Infer weekday robustly from nearby context.",
    "6) Ignore department headers and decorative markers.",
    "",
    "Output format (STRICT JSON ONLY, no markdown):",
    "{\"tasks\":[{\"day\":\"월|화|수|목|금\",\"task\":\"string\",\"details\":[\"string\", \"...\"]}]}",
    "",
    "Output quality requirements:",
    "- Every task must have day + task.",
    "- Keep details concise and clean.",
    "- Do not merge unrelated tasks.",
    "- Preserve all actionable tasks.",
    "",
    "PDF lines:",
    ...lines
  ].join("\n");
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

  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      body = {};
    }
  }

  const fileName = body.fileName || "weekly-plan.pdf";
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) {
    res.status(400).json({ error: "No PDF lines provided." });
    return;
  }

  const prompt = buildPrompt(fileName, lines);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
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
    const jsonText = extractJson(modelText);
    if (!jsonText) {
      res.status(502).json({ error: "Gemini response did not contain valid JSON." });
      return;
    }

    const parsed = JSON.parse(jsonText);
    const normalized = normalizeTasks(parsed.tasks);
    const tasks = cleanAndMergeTasks(normalized);
    if (!tasks.length) {
      res.status(422).json({ error: "Gemini parsed 0 tasks. Please retry with the same file." });
      return;
    }

    res.status(200).json({ tasks });
  } catch (error) {
    res.status(500).json({ error: error.message || "Server error while parsing PDF." });
  }
};
