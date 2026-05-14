const WEEKDAY_ORDER = ["일", "월", "화", "수", "목", "금", "토"];
const VALID_WEEKDAYS = new Set(["월", "화", "수", "목", "금"]);
const DETAIL_PREFIX = /^(시간|기간|담당|대상|장소|참석|내용|방법|준비|안내)\s*[:：]\s*/;
const DASH_PREFIX = /^[-–—]\s*/;
const TASK_BULLET = /❍/g;

function normalizeLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function inferRange(fileName) {
  const name = String(fileName || "");
  const year = Number((name.match(/(20\d{2})/) || [])[1] || 2026);
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

    // marker line often appears as this glyph
    if (line.includes("")) {
      flush();
      waitingDate = true;
      continue;
    }

    // bare date line: 11, 12, 13...
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

function isNoise(line) {
  return /^(교무기획부|교육연구부|학생안전부|마이스터기획부|취업지원부|상담복지부|글로벌역량강화부)$/.test(line);
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
    const cleaned = line.replace(DASH_PREFIX, "").replace(DETAIL_PREFIX, (m) => m.trim()).trim();
    if (cleaned) cur.details.push(cleaned);
  };

  for (let i = 0; i < blockLines.length; i += 1) {
    const raw = blockLines[i];
    const line = normalizeLine(raw);
    if (!line || isNoise(line)) continue;

    const bulletTasks = splitBulletTasks(line);
    if (bulletTasks.length > 0) {
      flush();
      // first segment starts current task
      cur = { task: bulletTasks[0], details: [] };
      // additional segments are additional tasks on same line
      for (let j = 1; j < bulletTasks.length; j += 1) {
        flush();
        cur = { task: bulletTasks[j], details: [] };
      }
      continue;
    }

    if (!cur) continue;

    // prefixed details
    if (DASH_PREFIX.test(line) || DETAIL_PREFIX.test(line)) {
      addDetail(line);
      continue;
    }

    // continuation logic:
    // if previous detail expects continued names, append to last detail
    if (cur.details.length > 0) {
      const last = cur.details[cur.details.length - 1];
      if (/^(참석|담당)\s*[:：]/.test(last) || /,$/.test(last) || /^[가-힣A-Za-z·,\s]+$/.test(line)) {
        cur.details[cur.details.length - 1] = `${last} ${line}`.replace(/\s+/g, " ").trim();
        continue;
      }
    }

    // if looks like wrapped title piece, append to task
    if (line.length <= 18 && !/^\d/.test(line) && !line.includes(":")) {
      cur.task = `${cur.task} ${line}`.replace(/\s+/g, " ").trim();
      continue;
    }

    // otherwise treat as detail
    addDetail(line);
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
    if (DASH_PREFIX.test(task) || DETAIL_PREFIX.test(task) || /^\d{1,2}:\d{2}\s*~/.test(task)) {
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
    for (const task of parsed) {
      collected.push({ day, task: task.task, details: task.details });
    }
  }

  const tasks = postClean(collected);
  if (!tasks.length) {
    res.status(422).json({ error: "업무 추출 결과가 비어 있습니다." });
    return;
  }

  res.status(200).json({ tasks });
};
