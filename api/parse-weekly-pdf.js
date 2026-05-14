const WEEKDAYS = ["월", "화", "수", "목", "금"];

function normalizeDay(day) {
  const value = String(day || "").trim();
  if (value.startsWith("월")) return "월";
  if (value.startsWith("화")) return "화";
  if (value.startsWith("수")) return "수";
  if (value.startsWith("목")) return "목";
  if (value.startsWith("금")) return "금";
  return "";
}

function isDetailLike(text) {
  const line = String(text || "").trim();
  if (!line) return true;
  if (/^[-–—]\s*/.test(line)) return true;
  if (/^(시간|기간|담당|대상|장소|참석|내용|방법|준비|안내)\s*[:：]/.test(line)) return true;
  if (/^\d{1,2}:\d{2}\s*~/.test(line)) return true;
  return false;
}

function cleanTasks(tasks) {
  const merged = [];
  for (const raw of tasks) {
    const day = normalizeDay(raw.day);
    const task = String(raw.task || "").trim();
    const details = Array.isArray(raw.details) ? raw.details.map((d) => String(d).trim()).filter(Boolean) : [];
    if (!day || !task) continue;

    if (/^[]+$/.test(task)) continue;
    if (/^\d{1,2}$/.test(task)) continue;
    if (/^(교무기획부|교육연구부|학생안전부|마이스터기획부|취업지원부|상담복지부|글로벌역량강화부)$/.test(task)) continue;

    if (isDetailLike(task) && merged.length > 0 && merged[merged.length - 1].day === day) {
      merged[merged.length - 1].details.push(task.replace(/^[-–—]\s*/, ""));
      merged[merged.length - 1].details.push(...details);
      continue;
    }

    merged.push({ day, task, details });
  }
  return merged.filter((t) => WEEKDAYS.includes(t.day));
}

function extractJson(text) {
  const src = String(text || "");
  const fenced = src.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : src;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function inferWeekRange(fileName) {
  // Example: 2026_주간업무계획_5월11일~5월15일.pdf
  const name = String(fileName || "");
  const yearMatch = name.match(/(20\d{2})/);
  const year = yearMatch ? Number(yearMatch[1]) : 2026;
  const rangeMatch = name.match(/(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!rangeMatch) return null;
  return {
    year,
    startMonth: Number(rangeMatch[1]),
    startDay: Number(rangeMatch[2]),
    endMonth: Number(rangeMatch[3]),
    endDay: Number(rangeMatch[4])
  };
}

function weekdayFromDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  return names[d.getDay()];
}

function splitBlocks(lines) {
  // Supports:
  // - marker line then date number line
  // - bare date number line
  const blocks = [];
  let currentDate = null;
  let currentLines = [];
  let waitDate = false;

  const flush = () => {
    if (currentDate && currentLines.length) {
      blocks.push({ date: currentDate, lines: currentLines.slice() });
    }
    currentDate = null;
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;

    const bareDateMatch = line.match(/^(\d{1,2})$/);
    if (bareDateMatch) {
      const n = Number(bareDateMatch[1]);
      if (n >= 1 && n <= 31) {
        flush();
        currentDate = n;
        waitDate = false;
        continue;
      }
    }

    if (line.includes("")) {
      flush();
      waitDate = true;
      continue;
    }

    if (waitDate) {
      const n = Number(line.replace(/[^\d]/g, ""));
      if (Number.isFinite(n) && n >= 1 && n <= 31) {
        currentDate = n;
        waitDate = false;
        continue;
      }
      waitDate = false;
    }

    if (currentDate !== null) currentLines.push(line);
  }

  flush();
  return blocks;
}

function dayPrompt(dayKor, date, blockLines) {
  return [
    "You are parsing one weekday block from a Korean school weekly task PDF.",
    `This block is fixed: ${dayKor}요일 (${date}일).`,
    "",
    "Rules:",
    "1) A task starts with '❍'.",
    "2) One line can contain multiple tasks: '❍A❍B' -> split.",
    "3) '-시간/-기간/-담당/-대상/-장소/-참석/-내용' lines belong to previous task.",
    "4) Wrapped continuation lines without '❍' should be appended to previous task.",
    "5) Do not emit pure detail lines as standalone tasks.",
    "",
    "Return STRICT JSON only:",
    "{\"tasks\":[{\"task\":\"string\",\"details\":[\"string\"]}]}",
    "",
    "Block lines:",
    ...blockLines
  ].join("\n");
}

async function callGemini(apiKey, prompt) {
  const resp = await fetch(
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

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error: ${text}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const json = extractJson(text);
  if (!json) throw new Error("Gemini response did not contain valid JSON.");
  return JSON.parse(json);
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
    const blocks = splitBlocks(lines);
    if (!week || !blocks.length) {
      res.status(422).json({ error: "PDF에서 날짜 블록(예: 11,12,13...)을 찾지 못했습니다." });
      return;
    }

    const collected = [];
    for (const block of blocks) {
      const day = weekdayFromDate(week.year, week.startMonth, block.date);
      if (!WEEKDAYS.includes(day)) continue;

      const parsed = await callGemini(apiKey, dayPrompt(day, block.date, block.lines));
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

      for (const t of tasks) {
        collected.push({
          day,
          task: String(t.task || "").trim(),
          details: Array.isArray(t.details) ? t.details.map((d) => String(d).trim()).filter(Boolean) : []
        });
      }
    }

    const tasks = cleanTasks(collected);
    if (!tasks.length) {
      res.status(422).json({ error: "업무 추출 결과가 비어 있습니다." });
      return;
    }

    res.status(200).json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error while parsing PDF." });
  }
};
