const WEEKDAY_SET = new Set(["월", "화", "수", "목", "금"]);

function normalizeDay(day) {
  const value = String(day || "").trim();
  if (value.startsWith("월")) return "월";
  if (value.startsWith("화")) return "화";
  if (value.startsWith("수")) return "수";
  if (value.startsWith("목")) return "목";
  if (value.startsWith("금")) return "금";
  return "";
}

function isLikelyDetailLine(text) {
  const line = String(text || "").trim();
  if (!line) return true;
  if (/^[-–—]\s*/.test(line)) return true;
  if (/^(시간|기간|담당|대상|장소|참석|내용|방법|준비|안내)\s*[:：]/.test(line)) return true;
  if (/^\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/.test(line)) return true;
  if (/^\d{1,2}:\d{2}\s*~/.test(line)) return true;
  return false;
}

function cleanAndMergeTasks(tasks) {
  const result = [];
  for (const raw of tasks) {
    const task = {
      day: normalizeDay(raw.day),
      task: String(raw.task || "").trim(),
      details: Array.isArray(raw.details) ? raw.details.map((d) => String(d).trim()).filter(Boolean) : []
    };
    if (!task.day || !task.task) continue;

    if (isLikelyDetailLine(task.task) && result.length > 0 && result[result.length - 1].day === task.day) {
      result[result.length - 1].details.push(task.task.replace(/^[-–—]\s*/, ""));
      result[result.length - 1].details.push(...task.details);
      continue;
    }

    result.push(task);
  }
  return result.filter((t) => WEEKDAY_SET.has(t.day) && t.task.length > 0);
}

function inferWeekRange(fileName) {
  // Example: 2026_주간업무계획_5월11일~5월15일.pdf
  const text = String(fileName || "");
  const yearMatch = text.match(/(20\d{2})/);
  const y = yearMatch ? Number(yearMatch[1]) : 2026;
  const rangeMatch = text.match(/(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!rangeMatch) return null;
  return {
    year: y,
    startMonth: Number(rangeMatch[1]),
    startDay: Number(rangeMatch[2]),
    endMonth: Number(rangeMatch[3]),
    endDay: Number(rangeMatch[4])
  };
}

function weekdayFromDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  // 0:일, 1:월 ... 6:토
  const map = ["일", "월", "화", "수", "목", "금", "토"];
  return map[d.getDay()];
}

function splitBlocksByDateMarker(lines) {
  // The attached PDF uses markers like "" then date number line.
  const blocks = [];
  let currentDate = null;
  let currentLines = [];
  let waitingDateNumber = false;

  const flush = () => {
    if (currentDate && currentLines.length) {
      blocks.push({ dateNumber: currentDate, lines: currentLines.slice() });
    }
    currentDate = null;
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;

    if (line.includes("")) {
      flush();
      waitingDateNumber = true;
      continue;
    }

    if (waitingDateNumber) {
      const n = Number(line.replace(/[^\d]/g, ""));
      if (Number.isFinite(n) && n > 0 && n <= 31) {
        currentDate = n;
        waitingDateNumber = false;
        continue;
      }
      // if marker detection failed, keep waiting state off and continue normally
      waitingDateNumber = false;
    }

    if (currentDate !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return blocks;
}

function buildDayFixedPrompt(dayKor, dateNumber, lines) {
  return [
    "You are parsing one single weekday block from a Korean school weekly task PDF.",
    `This block is fixed to: ${dayKor}요일 (${dateNumber}일)`,
    "",
    "Rules:",
    "1) A task starts with '❍'.",
    "2) If one line has multiple tasks like '❍A❍B', split them.",
    "3) Hyphen lines (-시간, -기간, -담당, -장소...) belong to the nearest previous task.",
    "4) Wrapped continuation lines without '❍' should be attached to the previous task.",
    "5) Do not create tasks from pure detail lines.",
    "",
    "Output STRICT JSON ONLY:",
    "{\"tasks\":[{\"task\":\"string\",\"details\":[\"string\"]}]}",
    "",
    "Block lines:",
    ...lines
  ].join("\n");
}

async function callGemini(apiKey, prompt) {
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
    throw new Error(`Gemini API error: ${errText}`);
  }

  const data = await response.json();
  const modelText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const first = modelText.indexOf("{");
  const last = modelText.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("Gemini response did not contain JSON.");
  }
  return JSON.parse(modelText.slice(first, last + 1));
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
      body = JSON.parse(body);
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

  try {
    const week = inferWeekRange(fileName);
    const blocks = splitBlocksByDateMarker(lines);
    if (!week || !blocks.length) {
      res.status(422).json({ error: "Could not detect day blocks from PDF." });
      return;
    }

    const allTasks = [];
    for (const block of blocks) {
      const dayKor = weekdayFromDate(week.year, week.startMonth, block.dateNumber);
      if (!WEEKDAY_SET.has(dayKor)) continue; // skip weekend blocks (e.g. 16일 토요일)
      const prompt = buildDayFixedPrompt(dayKor, block.dateNumber, block.lines);
      const parsed = await callGemini(apiKey, prompt);
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      for (const task of tasks) {
        allTasks.push({
          day: dayKor,
          task: String(task.task || "").trim(),
          details: Array.isArray(task.details) ? task.details.map((d) => String(d).trim()).filter(Boolean) : []
        });
      }
    }

    const cleaned = cleanAndMergeTasks(allTasks);
    if (!cleaned.length) {
      res.status(422).json({ error: "Gemini parsed 0 tasks after cleanup." });
      return;
    }

    res.status(200).json({ tasks: cleaned });
  } catch (error) {
    res.status(500).json({ error: error.message || "Server error while parsing PDF." });
  }
};
