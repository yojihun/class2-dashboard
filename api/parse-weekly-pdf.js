const WEEKDAY_ORDER = ["일", "월", "화", "수", "목", "금", "토"];
const VALID_WEEKDAYS = new Set(["월", "화", "수", "목", "금"]);

const DETAIL_PREFIX = /^(시간|기간|담당|대상|장소|참석|내용|방법|준비|안내)\s*[:：]?\s*/;
const DASH_PREFIX = /^[-•·▪❍\s]+/;
const TASK_BULLET = /❍/g;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

function normalizeLine(line) {
  return String(line || "").normalize("NFC").replace(/\s+/g, " ").trim();
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

function normalizePositionedItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      page: Number(item.page) || 1,
      text: normalizeLine(item.text),
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      width: Number(item.width) || 0
    }))
    .filter((item) => item.text);
}

function groupItemsIntoLines(items, tolerance = 4) {
  const lines = [];
  const sorted = items.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  for (const item of sorted) {
    let line = lines.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) <= tolerance);
    if (!line) {
      line = { page: item.page, y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
  }

  return lines
    .map((line) => ({
      ...line,
      items: line.items.slice().sort((a, b) => a.x - b.x)
    }))
    .sort((a, b) => a.page - b.page || a.y - b.y);
}

function inferColumnRanges(items, pageWidth) {
  const headers = ["교무기획부", "교육연구부", "학생안전부", "마이스터기획부", "취업지원부", "상담복지부", "글로벌역량강화부"];
  const centers = headers
    .map((header) => {
      const match = items.find((item) => item.text.includes(header));
      if (!match) return null;
      return match.x + match.width / 2;
    })
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (centers.length < 5) {
    return [
      [0, 151],
      [151, 267],
      [267, 380],
      [380, 493],
      [493, 604],
      [604, 720],
      [720, pageWidth || 850]
    ];
  }

  const ranges = [];
  for (let i = 0; i < centers.length; i += 1) {
    const left = i === 0 ? 0 : (centers[i - 1] + centers[i]) / 2;
    const right = i === centers.length - 1 ? pageWidth || centers[i] + 120 : (centers[i] + centers[i + 1]) / 2;
    ranges.push([left, right]);
  }
  return ranges;
}

function positionedDateMarkers(items, range) {
  const start = Math.min(range.startDay, range.endDay);
  const end = Math.max(range.startDay, range.endDay);
  return items
    .filter((item) => item.page === 1 && item.x < 70 && item.y > 90 && /^\d{1,2}$/.test(item.text))
    .map((item) => ({ date: Number(item.text), y: item.y }))
    .filter((marker) => marker.date >= start && marker.date <= end + 1)
    .sort((a, b) => a.y - b.y);
}

function splitPositionedBlocks(items, range) {
  const markers = positionedDateMarkers(items, range);
  const validMarkers = markers.filter((marker) => marker.date >= range.startDay && marker.date <= range.endDay);
  if (!validMarkers.length) return [];

  const pageWidth = Math.max(...items.map((item) => item.x + item.width), 841);
  const columnRanges = inferColumnRanges(items, pageWidth);
  const contentLines = groupItemsIntoLines(
    items.filter((item) => item.page === 1 && item.y > 85 && !/^(\d{1,2}|)$/.test(item.text))
  );
  const sectionStarts = [];
  for (let i = 0; i < contentLines.length; i += 1) {
    const prev = contentLines[i - 1];
    if (!prev || contentLines[i].y - prev.y > 10) sectionStarts.push(contentLines[i].y);
  }
  if (!sectionStarts.length) return [];

  const allMarkerSections = markers
    .map((marker) => {
      const top = sectionStarts.filter((start) => start <= marker.y + 1).at(-1);
      if (!Number.isFinite(top)) return null;
      return { ...marker, top };
    })
    .filter(Boolean)
    .sort((a, b) => a.top - b.top);

  return validMarkers.map((marker) => {
    const index = allMarkerSections.findIndex((item) => item.date === marker.date && item.y === marker.y);
    const current = allMarkerSections[index];
    if (!current) return null;
    const top = current.top;
    const bottom = allMarkerSections[index + 1]?.top || Number.POSITIVE_INFINITY;
    const bandItems = items.filter((item) => item.page === 1 && item.y >= top && item.y < bottom && !/^(\d{1,2}|)$/.test(item.text));
    const columnLines = columnRanges.map(([left, right]) => {
      const columnItems = bandItems.filter((item) => item.x >= left && item.x < right);
      return groupItemsIntoLines(columnItems)
        .map((line) => line.items.map((item) => item.text).join(" "))
        .filter(Boolean);
    });
    return { date: marker.date, columnLines };
  }).filter(Boolean);
}

function parsePositionedTasks(items, range) {
  const blocks = splitPositionedBlocks(items, range);
  const collected = [];
  for (const block of blocks) {
    const day = dayFromDate(range.year, range.startMonth, block.date);
    if (!VALID_WEEKDAYS.has(day)) continue;
    for (const lines of block.columnLines) {
      const parsed = parseBlockTasks(lines);
      for (const task of parsed) collected.push({ day, task: task.task, details: task.details });
    }
  }
  return postClean(collected);
}

function normalizeDayBlocks(dayBlocks) {
  if (!Array.isArray(dayBlocks)) return [];
  return dayBlocks
    .map((block) => {
      const day = normalizeLine(block.day).slice(0, 1);
      const columns = Array.isArray(block.columns)
        ? block.columns.map((column) => (Array.isArray(column) ? column.map(normalizeLine).filter(Boolean) : [])).filter((column) => column.length)
        : [];
      return {
        date: Number(block.date) || 0,
        day,
        columns
      };
    })
    .filter((block) => VALID_WEEKDAYS.has(block.day) && block.date && block.columns.length);
}

function parseDayBlocksLocally(dayBlocks) {
  const collected = [];
  for (const block of dayBlocks) {
    for (const lines of block.columns) {
      const parsed = parseBlockTasks(lines);
      for (const task of parsed) collected.push({ day: block.day, task: task.task, details: task.details });
    }
  }
  return postClean(collected);
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
    if (!details.length && /^[가-힣]{3}$/.test(task)) continue;
    if (!details.length && /^제\s*\d+\s*회$/.test(task)) continue;
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

function extractJson(text) {
  const src = String(text || "");
  const fenced = src.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : src;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function geminiBlockPrompt(day, date, columns) {
  const columnText = columns
    .map((lines, index) => [`[부서 컬럼 ${index + 1}]`, ...lines].join("\n"))
    .join("\n\n");
  return [
    "다음은 학교 주간업무계획 PDF에서 추출한 하루치 날짜 블록입니다.",
    `이 블록의 날짜/요일은 이미 확정되어 있습니다: ${date}일 ${day}요일.`,
    "요일을 추론하거나 변경하지 말고, 업무명과 상세만 추출하세요.",
    "반드시 JSON만 출력하세요.",
    '형식: {"tasks":[{"task":"업무명","details":["상세1","상세2"]}]}',
    "규칙:",
    "1) 업무 시작은 주로 '❍' 입니다.",
    "2) 한 줄에 '❍A❍B'처럼 여러 업무가 있으면 각각 분리합니다.",
    "3) '-시간', '-기간', '-담당', '-장소', '-대상', '-참석' 등은 직전 업무 상세입니다.",
    "4) 상세 줄 단독을 task로 만들지 마세요.",
    "5) 날짜, 요일, 부서명만 있는 줄은 task로 만들지 마세요.",
    "6) 서로 다른 부서 컬럼의 업무를 한 업무로 합치지 마세요.",
    "텍스트:",
    columnText.slice(0, 12000)
  ].join("\n");
}

async function parseBlockWithGemini(block, range = null) {
  if (!GEMINI_API_KEY) return null;

  const day = block.day || dayFromDate(range.year, range.startMonth, block.date);
  if (!VALID_WEEKDAYS.has(day)) return [];
  const columns = block.columns || [block.lines || []];
  const prompt = geminiBlockPrompt(day, block.date, columns);

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
  const parsed = JSON.parse(extractJson(text) || text);
  if (!Array.isArray(parsed?.tasks)) throw new Error("Gemini invalid JSON shape");

  return parsed.tasks
    .map((item) => {
      const task = normalizeLine(item?.task);
      const details = Array.isArray(item?.details) ? item.details.map(normalizeLine).filter(Boolean) : [];
      return task ? { day, task, details } : null;
    })
    .filter(Boolean);
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
  const positionedItems = normalizePositionedItems(body.items);
  const dayBlocks = normalizeDayBlocks(body.dayBlocks);
  if (!lines.length && !positionedItems.length && !dayBlocks.length) {
    res.status(400).json({ error: "No PDF text provided." });
    return;
  }

  if (dayBlocks.length) {
    try {
      const collected = [];
      for (const block of dayBlocks) {
        const parsed = await parseBlockWithGemini(block);
        if (parsed) collected.push(...parsed);
      }
      const tasks = postClean(collected);
      if (tasks.length) {
        res.status(200).json({ tasks, parser: "day-blocks-gemini", model: GEMINI_MODEL });
        return;
      }
    } catch {
      const tasks = parseDayBlocksLocally(dayBlocks);
      if (tasks.length) {
        res.status(200).json({ tasks, parser: "day-blocks-local" });
        return;
      }
    }

    const tasks = parseDayBlocksLocally(dayBlocks);
    if (tasks.length) {
      res.status(200).json({ tasks, parser: "day-blocks-local" });
      return;
    }
  }

  const range = inferRange(fileName);
  if (!range) {
    res.status(422).json({ error: "파일명에서 주간 범위를 찾지 못했습니다. 예: 5월11일~5월15일" });
    return;
  }

  if (positionedItems.length) {
    const positionedTasks = parsePositionedTasks(positionedItems, range);
    if (positionedTasks.length) {
      res.status(200).json({ tasks: positionedTasks, parser: "positioned-local" });
      return;
    }
  }

  const blocks = splitDateBlocks(lines);
  if (!blocks.length) {
    res.status(422).json({ error: "PDF에서 날짜 블록(11,12,13...)을 찾지 못했습니다." });
    return;
  }

  // Lock dates before Gemini runs. Gemini only extracts task text inside each date block.
  try {
    const geminiCollected = [];
    for (const block of blocks) {
      const parsed = await parseBlockWithGemini(block, range);
      if (parsed) geminiCollected.push(...parsed);
    }
    const geminiTasks = postClean(geminiCollected);
    if (geminiTasks.length) {
      res.status(200).json({ tasks: geminiTasks, parser: "gemini-date-blocks", model: GEMINI_MODEL });
      return;
    }
  } catch {
    // Silent fallback to deterministic local parser below.
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
