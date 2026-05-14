const WEEKDAY_ORDER = ["일", "월", "화", "수", "목", "금", "토"];
const VALID_WEEKDAYS = new Set(["월", "화", "수", "목", "금"]);

const DETAIL_PREFIX = /^(시간|기간|담당|대상|장소|참석|내용|방법|준비|안내)\s*[:：]?\s*/;
const DASH_PREFIX = /^[-•·▪❍\s]+/;
const TASK_BULLET = /❍/g;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

function normalizeLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function inferRange(fileName) {
  const name = String(fileName || "");
  const year = Number((name.match(/(20\d{2})/) || [])[1] || new Date().getFullYear());
  const m = name.match(/(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!m) return null;
  return {
    year,
    startMonth: Number(m[1]),
    startDay: Number(m[2]),
    endMonth: Number(m[3]),
    endDay: Number(m[4])
  };
}

function dayFromDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  return WEEKDAY_ORDER[d.getDay()];
}

function splitDateBlocks(lines) {
  const blocks = [];
  let currentDate = null;
  let current = [];
  let waitingDate = false;

  const flush = () => {
    if (currentDate !== null && current.length > 0) {
      blocks.push({ date: currentDate, lines: current.slice() });
    }
    currentDate = null;
    current = [];
  };

  for (const raw of lines) {
    const line = normalizeLine(raw);
    if (!line) continue;

    // Some school PDFs have a private-use glyph near the date cell.
    if (line.includes("")) {
      flush();
      waitingDate = true;
      continue;
    }

    if (/^\d{1,2}$/.test(line)) {
      const n = Number(line);
      if (n >= 1 && n <= 31) {
        flush();
        currentDate = n;
        waitingDate = false;
        continue;
      }
    }

    if (waitingDate) {
      const n = Number(line.replace(/[^\d]/g, ""));
      if (Number.isFinite(n) && n >= 1 && n <= 31) {
        currentDate = n;
        waitingDate = false;
        continue;
      }
      waitingDate = false;
    }

    if (currentDate !== null) current.push(line);
  }

  flush();
  return blocks;
}

function splitBulletTasks(line) {
  if (!line.includes("❍")) return [];
  return line
    .split(TASK_BULLET)
    .map((s) => normalizeLine(s))
    .filter(Boolean);
}

function parseBlockTasks(blockLines) {
  const tasks = [];
  let cur = null;

  const flush = () => {
    if (!cur || !cur.task) return;
    cur.task = normalizeLine(cur.task);
    cur.details = cur.details.map((d) => normalizeLine(d)).filter(Boolean);
    if (!cur.task) return;
    tasks.push(cur);
    cur = null;
  };

  const addDetail = (line) => {
    if (!cur) return;
    const cleaned = line.replace(DASH_PREFIX, "").replace(DETAIL_PREFIX, "").trim();
    if (cleaned) cur.details.push(cleaned);
  };

  for (const raw of blockLines) {
    const line = normalizeLine(raw);
    if (!line) continue;

    const bulletTasks = splitBulletTasks(line);
    if (bulletTasks.length > 0) {
      flush();
      cur = { task: bulletTasks[0], details: [] };
      for (let i = 1; i < bulletTasks.length; i += 1) {
        flush();
        cur = { task: bulletTasks[i], details: [] };
      }
      continue;
    }

    if (!cur) continue;

    if (DASH_PREFIX.test(line) || DETAIL_PREFIX.test(line)) {
      addDetail(line);
      continue;
    }

    // Append wrapped continuation fragments to details first.
    if (cur.details.length > 0) {
      cur.details[cur.details.length - 1] = `${cur.details[cur.details.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
      continue;
    }

    // Otherwise, treat as wrapped title fragment.
    cur.task = `${cur.task} ${line}`.replace(/\s+/g, " ").trim();
  }

  flush();
  return tasks;
}

function postClean(tasks) {
  const merged = [];
  for (const t of tasks) {
    const task = normalizeLine(t.task);
    const details = (t.details || []).map((d) => normalizeLine(d)).filter(Boolean);
    if (!task) continue;
    if (/^\d{1,2}$/.test(task)) continue;
    if (task === "") continue;
    if (DETAIL_PREFIX.test(task) || /^\d{1,2}:\d{2}\s*~/.test(task)) {
      if (merged.length > 0 && merged[merged.length - 1].day === t.day) {
        merged[merged.length - 1].details.push(task.replace(DASH_PREFIX, ""));
        merged[merged.length - 1].details.push(...details);
      }
      continue;
    }
    merged.push({ day: t.day, task, details });
  }
  return merged;
}

async function parseWithGemini(lines, fileName) {
  if (!GEMINI_API_KEY) return null;

  const prompt = [
    "다음은 학교 주간업무계획 PDF에서 추출한 텍스트 줄입니다.",
    "반드시 JSON만 출력하세요.",
    '형식: {"tasks":[{"day":"월","task":"업무명","details":["상세1","상세2"]}]}',
    "규칙:",
    "1) 업무 시작은 주로 '❍' 입니다.",
    "2) '-시간', '-기간', '-담당', '-장소', '-대상', '-참석' 등은 직전 업무 상세입니다.",
    "3) 요일은 월/화/수/목/금만 사용.",
    "4) 상세 줄 단독을 task로 만들지 마세요.",
    `파일명: ${fileName}`,
    "텍스트 줄:",
    ...lines.slice(0, 8000)
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API failed: ${response.status}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini empty response");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.tasks)) throw new Error("Gemini invalid JSON shape");
  return parsed.tasks;
}

function normalizeGeminiTasks(tasks) {
  const out = [];
  for (const item of tasks || []) {
    const day = normalizeLine(item?.day);
    const task = normalizeLine(item?.task);
    const details = Array.isArray(item?.details) ? item.details.map(normalizeLine).filter(Boolean) : [];
    if (!VALID_WEEKDAYS.has(day) || !task) continue;
    out.push({ day, task, details });
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
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

  // 1) Gemini first (cheapest configured model), 2) deterministic local parser.
  try {
    const geminiRaw = await parseWithGemini(lines, fileName);
    const geminiTasks = postClean(normalizeGeminiTasks(geminiRaw));
    if (geminiTasks.length) {
      res.status(200).json({ tasks: geminiTasks, parser: "gemini", model: GEMINI_MODEL });
      return;
    }
  } catch {
    // Silent fallback to local parser.
  }

  const range = inferRange(fileName);
  if (!range) {
    res.status(422).json({ error: "파일명에서 주간 범위를 찾지 못했습니다. 예: 5월11일~5월15일" });
    return;
  }

  const blocks = splitDateBlocks(lines);
  if (!blocks.length) {
    res.status(422).json({ error: "PDF에서 날짜 블록(11,12,13...)을 찾지 못했습니다." });
    return;
  }

  const collected = [];
  for (const block of blocks) {
    const day = dayFromDate(range.year, range.startMonth, block.date);
    if (!VALID_WEEKDAYS.has(day)) continue;
    const parsed = parseBlockTasks(block.lines);
    for (const task of parsed) collected.push({ day, task: task.task, details: task.details });
  }

  const tasks = postClean(collected);
  if (!tasks.length) {
    res.status(422).json({ error: "업무 추출 결과가 비어 있습니다." });
    return;
  }

  res.status(200).json({ tasks, parser: "local" });
};
