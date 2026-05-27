import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.worker.min.mjs";

const WEEKDAY_TO_INDEX = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
const DAY_NAMES = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일" };
const DAY_ORDER = ["일", "월", "화", "수", "목", "금", "토"];
const MANAGER_PASSWORD = "1234";
const MANAGER_AUTH_KEY = "class2-manager-auth";

const defaultSettings = {
  teacher: {
    name: "김지훈 선생님",
    subject: "영어",
    office: "3층 교사연구실 4",
    phone: "010-9435-1270",
    instagram: "@ur.friend.jihoon",
    instagramUrl: "https://www.instagram.com/ur.friend.jihoon"
  },
  messages: {
    teacherTitle: "오늘도 서로의 속도를 지켜주기",
    teacherBody: "해야 할 일은 분명하게, 말은 다정하게. 2반은 오늘도 충분히 잘 해낼 수 있습니다.",
    quote: "작은 준비가 하루를 덜 흔들리게 만든다."
  },
  quickLinks: [
    { label: "자기 성찰", url: "https://forms.gle/XaJFMDDVPiBCgqVUA" },
    { label: "건의함", url: "https://quizn.show/pbd/info/board/0835045" },
    { label: "익명상담", url: "https://quizn.show/pbd/info/board/0884859" }
  ],
  roles: [
    ["고민상담/연애상담", "최승우"],
    ["급식알리미", "전효민"],
    ["노래추천", "한병민"],
    ["노션관리1", "윤규태"],
    ["노션관리2", "이윤재"],
    ["명언추천", "유리한"],
    ["사진찍기1", "김규리"],
    ["사진찍기2", "최영민"],
    ["아침 출석부 열쇠. 건의사항/고민 쪽지", "황수미"],
    ["환기담당1", "이현민"],
    ["환기담당2", "조예지"],
    ["청소도구정리", "여서정"],
    ["핸드폰 돌려주기(종례)", "고성민"],
    ["핸드폰 수거(조회 전)·디벗", "김선민"]
  ],
  seatingRows: [
    ["고성민", "고희경", "권율", "김규리", "김선민", "박지성"],
    ["변지현", "여서정", "유리한", "윤규태", "이윤재", "이현민"],
    ["전효민", "조예지", "최승우", "최영민", "한병민", "황수미"]
  ]
};

let state = { plans: [], activePlanId: null, publishedPlanId: null, settings: defaultSettings, todos: [] };
let dirty = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function mergeSettings(settings = {}) {
  return {
    teacher: { ...defaultSettings.teacher, ...(settings.teacher || {}) },
    messages: { ...defaultSettings.messages, ...(settings.messages || {}) },
    quickLinks: Array.isArray(settings.quickLinks) && settings.quickLinks.length ? settings.quickLinks : defaultSettings.quickLinks,
    roles: Array.isArray(settings.roles) && settings.roles.length ? settings.roles : defaultSettings.roles,
    seatingRows: Array.isArray(settings.seatingRows) && settings.seatingRows.length ? settings.seatingRows : defaultSettings.seatingRows
  };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "서버 요청에 실패했습니다.");
  return data;
}

async function loadStateFromServer() {
  const status = document.querySelector("#plan-status");
  status.textContent = "Firestore에서 주간 계획을 불러오는 중입니다...";
  state = await apiRequest("/api/plans", { cache: "no-store" });
  state.settings = mergeSettings(state.settings);
  state.todos = Array.isArray(state.todos) ? state.todos : [];
  dirty = false;
  renderSettingsForm();
  renderManager();
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
  return String(text || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function inferRange(fileName) {
  const name = normalize(fileName);
  const year = Number((name.match(/(20\d{2})/) || [])[1] || new Date().getFullYear());
  const match = name.match(/(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!match) return null;
  return {
    year,
    startDay: Number(match[2]),
    endDay: Number(match[4]),
    month: Number(match[1])
  };
}

function dayFromDate(year, month, day) {
  return DAY_ORDER[new Date(year, month - 1, day).getDay()];
}

function groupItemsIntoLines(items, tolerance = 4) {
  const lines = [];
  const sorted = items.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  sorted.forEach((item) => {
    let line = lines.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) <= tolerance);
    if (!line) {
      line = { page: item.page, y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
  });
  return lines
    .map((line) => ({ ...line, items: line.items.slice().sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.page - b.page || a.y - b.y);
}

function inferColumnRanges(items) {
  const headers = ["교무기획부", "교육연구부", "학생안전부", "마이스터기획부", "취업지원부", "상담복지부", "글로벌역량강화부"];
  const pageWidth = Math.max(...items.map((item) => item.x + item.width), 841);
  const centers = headers
    .map((header) => items.find((item) => item.text.includes(header)))
    .filter(Boolean)
    .map((item) => item.x + item.width / 2)
    .sort((a, b) => a - b);

  if (centers.length < 5) return [[0, 151], [151, 267], [267, 380], [380, 493], [493, 604], [604, 720], [720, pageWidth]];

  return centers.map((center, index) => {
    const left = index === 0 ? 0 : (centers[index - 1] + center) / 2;
    const right = index === centers.length - 1 ? pageWidth : (center + centers[index + 1]) / 2;
    return [left, right];
  });
}

function buildDayBlocks(items, fileName) {
  const range = inferRange(fileName);
  if (!range || !items.length) return [];

  const start = Math.min(range.startDay, range.endDay);
  const end = Math.max(range.startDay, range.endDay);
  const markers = items
    .filter((item) => item.page === 1 && item.x < 70 && item.y > 90 && /^\d{1,2}$/.test(item.text))
    .map((item) => ({ date: Number(item.text), y: item.y }))
    .filter((marker) => marker.date >= start && marker.date <= end + 1)
    .sort((a, b) => a.y - b.y);
  const validMarkers = markers.filter((marker) => marker.date >= start && marker.date <= end);
  if (!validMarkers.length) return [];

  const contentLines = groupItemsIntoLines(items.filter((item) => item.page === 1 && item.y > 85 && !/^(\d{1,2}|)$/.test(item.text)));
  const sectionStarts = contentLines.reduce((starts, line, index) => {
    const previous = contentLines[index - 1];
    if (!previous || line.y - previous.y > 10) starts.push(line.y);
    return starts;
  }, []);
  const markerSections = markers
    .map((marker) => ({ ...marker, top: sectionStarts.filter((startY) => startY <= marker.y + 1).at(-1) }))
    .filter((marker) => Number.isFinite(marker.top))
    .sort((a, b) => a.top - b.top);
  const columnRanges = inferColumnRanges(items);

  return validMarkers
    .map((marker) => {
      const index = markerSections.findIndex((item) => item.date === marker.date && item.y === marker.y);
      const current = markerSections[index];
      if (!current) return null;
      const next = markerSections[index + 1];
      const top = current.top;
      const bottom = next ? (next.top > top ? next.top : next.y) : Infinity;
      const bandItems = items.filter((item) => item.page === 1 && item.y >= top && item.y < bottom && !/^(\d{1,2}|)$/.test(item.text));
      const columns = columnRanges.map(([left, right]) =>
        groupItemsIntoLines(bandItems.filter((item) => item.x >= left && item.x < right))
          .map((line) => line.items.map((item) => item.text).join(" "))
          .filter(Boolean)
      );
      return {
        date: marker.date,
        day: dayFromDate(range.year, range.month, marker.date),
        columns
      };
    })
    .filter((block) => block && WEEKDAY_TO_INDEX[block.day]);
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

async function extractPdfContent(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const lines = [];
  const items = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str || "").join(" ");
    content.items.forEach((it) => {
      const value = normalize(it.str || "");
      if (!value || !it.transform) return;
      items.push({
        page: i,
        text: value,
        x: Number(it.transform[4]) || 0,
        y: viewport.height - (Number(it.transform[5]) || 0),
        width: Number(it.width) || 0
      });
    });
    text.split(/\s{2,}|\n/).forEach((line) => {
      const n = normalize(line);
      if (n) lines.push(n);
    });
  }
  return { lines, items, dayBlocks: buildDayBlocks(items, file.name) };
}

async function parseWithServer(lines, items, dayBlocks, fileName) {
  const response = await fetch("/api/parse-weekly-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: normalize(fileName), lines, items, dayBlocks })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Gemini 파서 실패" }));
    throw new Error(err.error || "Gemini 파서 실패");
  }
  const data = await response.json();
  return {
    tasks: mapGeminiTasks(data.tasks || []),
    parserName: data.parser || "server"
  };
}

async function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.querySelector("#plan-status");
  status.textContent = "업로드한 PDF를 분석 중입니다...";

  try {
    const { lines, items, dayBlocks } = await extractPdfContent(file);
    let tasks = [];
    let parserName = "로컬";
    try {
      const parsed = await parseWithServer(lines, items, dayBlocks, file.name);
      tasks = parsed.tasks;
      parserName = parsed.parserName;
    } catch (error) {
      if (dayBlocks.length) throw error;
      tasks = parsePdfLocally(lines);
    }
    if (!tasks.length) throw new Error("요일별 업무 항목을 찾지 못했습니다.");

    const title = file.name.replace(/\.pdf$/i, "");
    state = await apiRequest("/api/plans", {
      method: "POST",
      body: JSON.stringify({
        title,
        sourceFileName: file.name,
        parserName,
        tasks
      })
    });
    renderManager();
    setDirty(true);
    status.textContent = `업로드 완료: ${title} (${tasks.length}개 항목, ${parserName} 파서). 저장을 눌러 반영하세요.`;
  } catch (error) {
    status.textContent = `업로드 실패: ${error.message}`;
  } finally {
    event.target.value = "";
  }
}

async function setActivePlan(id) {
  try {
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "setActivePlan", planId: id })
    });
    renderManager();
    setDirty(true);
  } catch (error) {
    document.querySelector("#plan-status").textContent = `선택 변경 실패: ${error.message}`;
  }
}

async function toggleHomeroom(taskId, checked) {
  const plan = currentPlan();
  if (!plan) return;
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.homeroom = checked;
  renderManager();
  setDirty(true);
  try {
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "toggleTask", planId: plan.id, taskId, homeroom: checked })
    });
    renderManager();
    setDirty(true);
  } catch (error) {
    task.homeroom = !checked;
    renderManager();
    document.querySelector("#plan-status").textContent = `체크 저장 실패: ${error.message}`;
  }
}

async function savePublishedPlan() {
  if (!state.activePlanId) return;
  try {
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "publish", planId: state.activePlanId })
    });
    dirty = false;
    const status = document.querySelector("#plan-status");
    status.textContent = "저장 완료: 현재 선택한 플랜이 학생용 대시보드에 반영되었습니다.";
    renderManager();
  } catch (error) {
    document.querySelector("#plan-status").textContent = `저장 실패: ${error.message}`;
  }
}

function renderPublishedLabel() {
  const label = document.querySelector("#published-plan-label");
  const published = state.plans.find((p) => p.id === state.publishedPlanId);
  label.textContent = published ? `현재 반영: ${published.title}` : "현재 반영: 없음";
}

function rowsToText(rows) {
  return rows.map((row) => row.join(" | ")).join("\n");
}

function linksToText(links) {
  return links.map((link) => `${link.label} | ${link.url}`).join("\n");
}

function seatingToText(rows) {
  return rows.map((row) => row.join(", ")).join("\n");
}

function parsePairLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      return [parts[0], parts[parts.length - 1]];
    })
    .filter(Boolean);
}

function parseSeatingRows(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.split(",").map((name) => name.trim()).filter(Boolean))
    .filter((row) => row.length);
}

function renderSettingsForm() {
  const settings = mergeSettings(state.settings);
  document.querySelector("#teacher-name-input").value = settings.teacher.name;
  document.querySelector("#teacher-subject-input").value = settings.teacher.subject;
  document.querySelector("#teacher-office-input").value = settings.teacher.office;
  document.querySelector("#teacher-phone-input").value = settings.teacher.phone;
  document.querySelector("#teacher-instagram-input").value = settings.teacher.instagram;
  document.querySelector("#teacher-instagram-url-input").value = settings.teacher.instagramUrl;
  document.querySelector("#message-title-input").value = settings.messages.teacherTitle;
  document.querySelector("#message-body-input").value = settings.messages.teacherBody;
  document.querySelector("#quote-input").value = settings.messages.quote;
  document.querySelector("#quick-links-input").value = linksToText(settings.quickLinks);
  document.querySelector("#roles-input").value = rowsToText(settings.roles);
  document.querySelector("#seating-input").value = seatingToText(settings.seatingRows);
  document.querySelector("#settings-status").textContent = "현재 설정을 불러왔습니다.";
}

function collectSettingsForm() {
  const quickLinks = parsePairLines(document.querySelector("#quick-links-input").value).map(([label, url]) => ({ label, url }));
  return {
    teacher: {
      name: document.querySelector("#teacher-name-input").value.trim(),
      subject: document.querySelector("#teacher-subject-input").value.trim(),
      office: document.querySelector("#teacher-office-input").value.trim(),
      phone: document.querySelector("#teacher-phone-input").value.trim(),
      instagram: document.querySelector("#teacher-instagram-input").value.trim(),
      instagramUrl: document.querySelector("#teacher-instagram-url-input").value.trim()
    },
    messages: {
      teacherTitle: document.querySelector("#message-title-input").value.trim(),
      teacherBody: document.querySelector("#message-body-input").value.trim(),
      quote: document.querySelector("#quote-input").value.trim()
    },
    quickLinks,
    roles: parsePairLines(document.querySelector("#roles-input").value),
    seatingRows: parseSeatingRows(document.querySelector("#seating-input").value)
  };
}

async function saveDashboardSettings() {
  const status = document.querySelector("#settings-status");
  try {
    status.textContent = "대시보드 설정을 저장하는 중입니다...";
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "updateSettings", settings: collectSettingsForm() })
    });
    state.settings = mergeSettings(state.settings);
    renderSettingsForm();
    renderManager();
    status.textContent = "저장 완료: 대시보드 설정이 반영되었습니다.";
  } catch (error) {
    status.textContent = `설정 저장 실패: ${error.message}`;
  }
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
        ${day.items
          .map(
            (task) => `
          <div class="plan-item">
            <input type="checkbox" data-task-id="${task.id}" ${task.homeroom ? "checked" : ""}>
            <input type="text" class="task-text-input" data-task-id="${task.id}" data-original="">
            <button type="button" class="task-delete-btn" data-task-id="${task.id}" title="삭제">×</button>
          </div>`
          )
          .join("")}
        ${!day.items.length ? '<p class="empty-day">추출된 항목 없음</p>' : ""}
        <button type="button" class="add-task-btn" data-day="${day.d}">+ 항목 추가</button>
      </section>`
    )
    .join("");

  wrap.querySelectorAll(".task-text-input").forEach((input) => {
    const task = plan.tasks.find((t) => t.id === input.dataset.taskId);
    if (task) {
      input.value = task.text;
      input.dataset.original = task.text;
    }
  });

  wrap.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", (e) => toggleHomeroom(e.target.dataset.taskId, e.target.checked));
  });

  wrap.querySelectorAll(".task-text-input").forEach((input) => {
    input.addEventListener("blur", (e) => {
      const text = e.target.value.trim();
      if (!text || text === e.target.dataset.original) return;
      e.target.dataset.original = text;
      editTaskText(e.target.dataset.taskId, text);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.blur();
      if (e.key === "Escape") {
        e.target.value = e.target.dataset.original;
        e.target.blur();
      }
    });
  });

  wrap.querySelectorAll(".task-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => removeTask(e.currentTarget.dataset.taskId));
  });

  wrap.querySelectorAll(".add-task-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => addNewTask(Number(e.currentTarget.dataset.day)));
  });

  renderPublishedLabel();
  renderTodos();
}

function renderTodos() {
  const list = document.querySelector("#todo-list");
  if (!list) return;
  const todos = state.todos || [];
  if (!todos.length) {
    list.innerHTML = '<p class="empty-day">등록된 할일이 없습니다.</p>';
    return;
  }
  list.innerHTML = todos
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((todo) => `
      <div class="todo-row">
        <span class="todo-date">${escapeHtml(todo.dueDate)}</span>
        ${todo.period ? `<span class="badge">${escapeHtml(todo.period)}교시</span>` : ""}
        ${todo.subject ? `<span class="badge muted">${escapeHtml(todo.subject)}</span>` : ""}
        <span class="todo-task">${escapeHtml(todo.task)}</span>
        <button class="task-delete-btn" data-todo-id="${escapeHtml(todo.id)}" title="삭제">×</button>
      </div>`)
    .join("");
  list.querySelectorAll(".task-delete-btn[data-todo-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => removeTodo(e.currentTarget.dataset.todoId));
  });
}

async function addTodoItem() {
  const dateInput = document.querySelector("#todo-date-input");
  const periodInput = document.querySelector("#todo-period-input");
  const subjectInput = document.querySelector("#todo-subject-input");
  const taskInput = document.querySelector("#todo-task-input");
  const status = document.querySelector("#todo-status");

  const dueDate = dateInput.value;
  const period = periodInput.value;
  const subject = subjectInput.value.trim();
  const task = taskInput.value.trim();

  if (!dueDate || !task) {
    status.textContent = "날짜와 할일 내용은 필수입니다.";
    return;
  }

  try {
    status.textContent = "저장 중...";
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "addTodo", todo: { id: crypto.randomUUID(), dueDate, period, subject, task } })
    });
    state.settings = mergeSettings(state.settings);
    state.todos = Array.isArray(state.todos) ? state.todos : [];
    taskInput.value = "";
    subjectInput.value = "";
    periodInput.value = "";
    renderTodos();
    status.textContent = "할일이 추가되었습니다.";
  } catch (error) {
    status.textContent = `추가 실패: ${error.message}`;
  }
}

async function removeTodo(todoId) {
  if (!confirm("이 할일을 삭제하시겠습니까?")) return;
  const status = document.querySelector("#todo-status");
  try {
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "deleteTodo", todoId })
    });
    state.settings = mergeSettings(state.settings);
    state.todos = Array.isArray(state.todos) ? state.todos : [];
    renderTodos();
    status.textContent = "삭제되었습니다.";
  } catch (error) {
    status.textContent = `삭제 실패: ${error.message}`;
  }
}

async function editTaskText(taskId, text) {
  const plan = currentPlan();
  if (!plan) return;
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const original = task.text;
  task.text = text;
  setDirty(true);
  try {
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "editTask", planId: plan.id, taskId, text })
    });
  } catch (error) {
    task.text = original;
    const input = document.querySelector(`.task-text-input[data-task-id="${taskId}"]`);
    if (input) { input.value = original; input.dataset.original = original; }
    document.querySelector("#plan-status").textContent = `수정 실패: ${error.message}`;
  }
}

async function removeTask(taskId) {
  const plan = currentPlan();
  if (!plan) return;
  if (!confirm("이 항목을 삭제하시겠습니까?")) return;
  try {
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "deleteTask", planId: plan.id, taskId })
    });
    renderManager();
    setDirty(true);
  } catch (error) {
    document.querySelector("#plan-status").textContent = `삭제 실패: ${error.message}`;
  }
}

async function addNewTask(dayIndex) {
  const plan = currentPlan();
  if (!plan) return;
  try {
    state = await apiRequest("/api/plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "addTask", planId: plan.id, dayIndex, text: "새 항목" })
    });
    renderManager();
    setDirty(true);
    const daySections = document.querySelectorAll(".plan-day");
    const section = daySections[dayIndex - 1];
    const inputs = section?.querySelectorAll(".task-text-input");
    if (inputs?.length) {
      const last = inputs[inputs.length - 1];
      last.focus();
      last.select();
    }
  } catch (error) {
    document.querySelector("#plan-status").textContent = `추가 실패: ${error.message}`;
  }
}

function bindEvents() {
  document.querySelector("#weekly-pdf-input").addEventListener("change", handleUpload);
  document.querySelector("#plan-select").addEventListener("change", (e) => setActivePlan(e.target.value));
  document.querySelector("#save-plan-btn").addEventListener("click", savePublishedPlan);
  document.querySelector("#save-settings-btn").addEventListener("click", saveDashboardSettings);
  document.querySelector("#add-todo-btn").addEventListener("click", addTodoItem);
}

function unlockManager() {
  document.body.classList.remove("manager-locked");
}

function bindManagerLogin() {
  const form = document.querySelector("#manager-login-form");
  const input = document.querySelector("#manager-password-input");
  const status = document.querySelector("#manager-login-status");
  if (!form || !input || !status) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (input.value === MANAGER_PASSWORD) {
      sessionStorage.setItem(MANAGER_AUTH_KEY, "ok");
      unlockManager();
      initManager();
      return;
    }
    input.value = "";
    input.focus();
    status.textContent = "비밀번호가 맞지 않습니다.";
  });
}

async function init() {
  bindManagerLogin();
  if (sessionStorage.getItem(MANAGER_AUTH_KEY) === "ok") {
    unlockManager();
    await initManager();
  }
}

async function initManager() {
  bindEvents();
  try {
    await loadStateFromServer();
  } catch (error) {
    document.querySelector("#plan-status").textContent = `Firestore 연결 실패: ${error.message}`;
  }
}

init();
