import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.worker.min.mjs";

const STORAGE_KEY = "class2_weekly_plans_v2";
const WEEKDAY_TO_INDEX = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
const DAY_NAMES = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일" };

let state = loadState();

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      activePlanId: parsed.activePlanId || null
    };
  } catch {
    return { plans: [], activePlanId: null };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentPlan() {
  return state.plans.find((p) => p.id === state.activePlanId) || null;
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function detectDay(line) {
  const match = normalize(line).match(/^(월|화|수|목|금)\s*[\.:]?\s*(\d{1,2})?/);
  return match ? WEEKDAY_TO_INDEX[match[1]] : null;
}

function parsePdfLocally(lines) {
  const tasks = [];
  let dayIndex = null;
  let currentTask = null;

  const flush = () => {
    if (!currentTask || !currentTask.title) return;
    const detailText = currentTask.details.filter(Boolean).join(" / ");
    tasks.push({
      id: crypto.randomUUID(),
      dayIndex: currentTask.dayIndex,
      text: detailText ? `${currentTask.title} (${detailText})` : currentTask.title,
      homeroom: false
    });
    currentTask = null;
  };

  for (const rawLine of lines) {
    const line = normalize(rawLine);
    if (!line) continue;
    const day = detectDay(line);
    if (day) {
      flush();
      dayIndex = day;
      continue;
    }
    if (!dayIndex) continue;

    if (line.includes("❍")) {
      flush();
      currentTask = {
        dayIndex,
        title: line.replace(/^.*?❍\s*/, "").trim(),
        details: []
      };
      continue;
    }
    if (!currentTask) continue;

    if (line.startsWith("-")) {
      currentTask.details.push(line.replace(/^-+\s*/, "").trim());
    } else {
      currentTask.details.push(line);
    }
  }

  flush();
  return tasks;
}

function mapGeminiTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];
  return rawTasks
    .map((item) => {
      const dayIndex = WEEKDAY_TO_INDEX[item.day];
      if (!dayIndex || !item.task) return null;
      const details = Array.isArray(item.details) ? item.details.filter(Boolean) : [];
      return {
        id: crypto.randomUUID(),
        dayIndex,
        text: details.length ? `${item.task} (${details.join(" / ")})` : item.task,
        homeroom: false
      };
    })
    .filter(Boolean);
}

async function extractPdfLines(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const lines = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str || "").join(" ");
    text.split(/\s{2,}|\n/).forEach((line) => {
      const n = normalize(line);
      if (n) lines.push(n);
    });
  }
  return lines;
}

async function parseWithGemini(lines, fileName) {
  const response = await fetch("/api/parse-weekly-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, lines })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Gemini 파서 실패" }));
    throw new Error(err.error || "Gemini 파서 실패");
  }
  const data = await response.json();
  return mapGeminiTasks(data.tasks || []);
}

async function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.querySelector("#plan-status");
  status.textContent = "업로드한 PDF를 분석 중입니다...";

  try {
    const lines = await extractPdfLines(file);
    let tasks = [];
    let parserName = "로컬";
    try {
      tasks = await parseWithGemini(lines, file.name);
      parserName = "Gemini";
    } catch {
      tasks = parsePdfLocally(lines);
    }
    if (!tasks.length) throw new Error("요일별 업무 항목을 찾지 못했습니다.");

    const plan = {
      id: crypto.randomUUID(),
      title: file.name.replace(/\.pdf$/i, ""),
      createdAt: new Date().toISOString(),
      tasks
    };
    state.plans.unshift(plan);
    state.activePlanId = plan.id;
    saveState();
    renderManager();
    status.textContent = `업로드 완료: ${plan.title} (${tasks.length}개 항목, ${parserName} 파서)`;
  } catch (error) {
    status.textContent = `업로드 실패: ${error.message}`;
  } finally {
    event.target.value = "";
  }
}

function setActivePlan(id) {
  state.activePlanId = id;
  saveState();
  renderManager();
}

function toggleHomeroom(taskId, checked) {
  const plan = currentPlan();
  if (!plan) return;
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.homeroom = checked;
  saveState();
  renderManager();
}

function renderManager() {
  const select = document.querySelector("#plan-select");
  const status = document.querySelector("#plan-status");
  const wrap = document.querySelector("#plan-tasks");

  select.innerHTML = "";
  if (!state.plans.length) {
    select.disabled = true;
    wrap.innerHTML = "";
    status.textContent = "아직 업로드된 주간 업무가 없습니다.";
    return;
  }

  select.disabled = false;
  state.plans.forEach((plan) => {
    const opt = document.createElement("option");
    opt.value = plan.id;
    opt.textContent = plan.title;
    opt.selected = plan.id === state.activePlanId;
    select.append(opt);
  });

  const plan = currentPlan();
  if (!plan) return;
  const marked = plan.tasks.filter((t) => t.homeroom).length;
  status.textContent = `${plan.title} · 2반 반영 항목: ${marked}/${plan.tasks.length}`;

  const days = [1, 2, 3, 4, 5].map((d) => ({ d, items: plan.tasks.filter((t) => t.dayIndex === d) }));
  wrap.innerHTML = days
    .map(
      (day) => `
      <section class="plan-day">
        <h3>${DAY_NAMES[day.d]}</h3>
        ${
          day.items.length
            ? day.items
                .map(
                  (task) => `
          <label class="plan-item">
            <input type="checkbox" data-task-id="${task.id}" ${task.homeroom ? "checked" : ""}>
            <span>${task.text}</span>
          </label>`
                )
                .join("")
            : '<p class="empty-day">추출된 항목 없음</p>'
        }
      </section>`
    )
    .join("");

  wrap.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", (e) => toggleHomeroom(e.target.dataset.taskId, e.target.checked));
  });
}

function bindEvents() {
  document.querySelector("#weekly-pdf-input").addEventListener("change", handleUpload);
  document.querySelector("#plan-select").addEventListener("change", (e) => setActivePlan(e.target.value));
}

function init() {
  bindEvents();
  renderManager();
}

init();
