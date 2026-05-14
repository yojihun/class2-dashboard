import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.worker.min.mjs";

const STORAGE_KEY = "class2_weekly_plans_v2";
const WEEKDAY_TO_INDEX = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
const DAY_NAMES = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일" };

let state = loadState();
let dirty = false;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      activePlanId: parsed.activePlanId || null,
      publishedPlanId: parsed.publishedPlanId || null
    };
  } catch {
    return { plans: [], activePlanId: null, publishedPlanId: null };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentPlan() {
  return state.plans.find((p) => p.id === state.activePlanId) || null;
}

function setDirty(value) {
  dirty = value;
  const status = document.querySelector("#plan-status");
  if (value) {
    status.textContent = "변경사항이 있습니다. 저장 버튼을 눌러야 대시보드에 반영됩니다.";
  }
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function detectDay(line) {
  const text = normalize(line);
  const startMatch = text.match(/^(월|화|수|목|금)\s*[\.:]?\s*(\d{1,2})?/);
  if (startMatch) return WEEKDAY_TO_INDEX[startMatch[1]];
  const innerMatch = text.match(/(?:\(|\[)?(월|화|수|목|금)(?:\)|\])?\s*(?:요일)?/);
  return innerMatch ? WEEKDAY_TO_INDEX[innerMatch[1]] : 0;
}

function parsePdfLocally(lines) {
  const tasks = [];
  let dayIndex = 0;
  let currentTask = null;
  const taskStartPattern = /[❍○◦●▪□■]/;

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

    if (taskStartPattern.test(line)) {
      const split = line.split(/[❍○◦●▪□■]/).map((s) => s.trim()).filter(Boolean);
      if (!split.length) continue;
      flush();
      currentTask = { dayIndex, title: split[0], details: [] };
      for (let i = 1; i < split.length; i += 1) {
        flush();
        currentTask = { dayIndex, title: split[i], details: [] };
      }
      continue;
    }

    if (!currentTask) continue;
    if (/^[-–—]\s*/.test(line) || /^(시간|기간|담당|대상|장소|참석|내용)\s*[:：]/.test(line)) {
      currentTask.details.push(line.replace(/^[-–—]\s*/, ""));
    } else {
      currentTask.details.push(line);
    }
  }
  flush();
  return tasks;
}

function mapGeminiTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];
  const mapDay = (value) => {
    const day = String(value || "").trim();
    if (day.startsWith("월")) return 1;
    if (day.startsWith("화")) return 2;
    if (day.startsWith("수")) return 3;
    if (day.startsWith("목")) return 4;
    if (day.startsWith("금")) return 5;
    return 0;
  };

  return rawTasks
    .map((item) => {
      const dayIndex = mapDay(item.day);
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
    setDirty(true);
    status.textContent = `업로드 완료: ${plan.title} (${tasks.length}개 항목, ${parserName} 파서). 저장을 눌러 반영하세요.`;
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
  setDirty(true);
}

function toggleHomeroom(taskId, checked) {
  const plan = currentPlan();
  if (!plan) return;
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.homeroom = checked;
  renderManager();
  setDirty(true);
}

function savePublishedPlan() {
  if (!state.activePlanId) return;
  state.publishedPlanId = state.activePlanId;
  saveState();
  dirty = false;
  const status = document.querySelector("#plan-status");
  status.textContent = "저장 완료: 현재 선택한 플랜이 학생용 대시보드에 반영되었습니다.";
  renderPublishedLabel();
}

function renderPublishedLabel() {
  const label = document.querySelector("#published-plan-label");
  const published = state.plans.find((p) => p.id === state.publishedPlanId);
  label.textContent = published ? `현재 반영: ${published.title}` : "현재 반영: 없음";
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
    renderPublishedLabel();
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
  if (!dirty) status.textContent = `${plan.title} · 2반 반영 체크: ${marked}/${plan.tasks.length}`;

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
  renderPublishedLabel();
}

function bindEvents() {
  document.querySelector("#weekly-pdf-input").addEventListener("change", handleUpload);
  document.querySelector("#plan-select").addEventListener("change", (e) => setActivePlan(e.target.value));
  document.querySelector("#save-plan-btn").addEventListener("click", savePublishedPlan);
}

function init() {
  bindEvents();
  renderManager();
}

init();
