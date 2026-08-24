const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_NAMES_LONG = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일" };
const VIEW_ORDER = ["schedule", "duties", "roles", "seating"];

const students = ["고성민", "고희경", "권율", "김규리", "김선민", "박지성", "변지현", "여서정", "유리한", "윤규태", "이윤재", "이현민", "전효민", "조예지", "최승우", "최영민", "한병민", "황수미"];
const cleaningAssignments = ["쓸기1", "쓸기2", "쓸기3", "바닦1", "바닦2", "휴지통1", "휴지통2", "닦기1", "닦기2", "닦기3", "닦기4", "교탁정리", "꿈담카페1", "꿈담카페2", "꿈담카페3", "2-2계단1", "2-2계단2", "2-2계단3"];
const CLEANING_BASE_START_NAME = "최영민";
const DUTY_BASE_START_NAME = "유리한";
const defaultRoles = [
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
];
const defaultSeatingRows = [
  ["고성민", "고희경", "권율", "김규리", "김선민", "박지성"],
  ["변지현", "여서정", "유리한", "윤규태", "이윤재", "이현민"],
  ["전효민", "조예지", "최승우", "최영민", "한병민", "황수미"]
];
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
  roles: defaultRoles,
  seatingRows: defaultSeatingRows
};

const fallbackSchedules = {
  1: [["08:05", "주번 조회"], ["1교시", "자치활동"]],
  2: [["08:10", "조회"], ["16:30", "방과후학교 A"], ["18:20", "방과후학교 B"]],
  3: [["6-7교시", "멘토링"], ["청소 전", "교실 준비"]],
  4: [["3교시 후", "일과 조정"], ["종례 전", "교실 점검"]],
  5: [["16:30", "방과후학교 A"], ["종례", "주간 정리"]]
};

let dashboardState = { plans: [], activePlanId: null, publishedPlanId: null, settings: defaultSettings };
let todaySubjects = Array(7).fill("-");
let environmentState = null;
let mealState = null;
let stateSignature = "";
let weekOffset = 0;

const TODAY_SHEET_ID = "1SzXgcGveGAhkl0_SvMlV2t2dRLvIGFZCWg4ybydJHHM";
const PERIOD_RULES = [
  { key: "1", label: "1교시", subjectIndex: 0, start: [8, 20], end: [9, 10] },
  { key: "2", label: "2교시", subjectIndex: 1, start: [9, 20], end: [10, 10] },
  { key: "3", label: "3교시", subjectIndex: 2, start: [10, 20], end: [11, 10] },
  { key: "4", label: "4교시", subjectIndex: 3, start: [11, 20], end: [12, 10] },
  { key: "LUNCH", label: "점심시간", subjectIndex: null, start: [12, 10], end: [13, 0] },
  { key: "5", label: "5교시", subjectIndex: 4, start: [13, 0], end: [13, 50] },
  { key: "6", label: "6교시", subjectIndex: 5, start: [14, 0], end: [14, 50] },
  { key: "7", label: "7교시", subjectIndex: 6, start: [15, 0], end: [15, 50], blockedWeekdays: [1, 5] }
];

function mergeSettings(settings = {}) {
  return {
    teacher: { ...defaultSettings.teacher, ...(settings.teacher || {}) },
    messages: { ...defaultSettings.messages, ...(settings.messages || {}) },
    quickLinks: Array.isArray(settings.quickLinks) && settings.quickLinks.length ? settings.quickLinks : defaultSettings.quickLinks,
    roles: Array.isArray(settings.roles) && settings.roles.length ? settings.roles : defaultSettings.roles,
    seatingRows: Array.isArray(settings.seatingRows) && settings.seatingRows.length ? settings.seatingRows : defaultSettings.seatingRows
  };
}

function buildStateSignature(state) {
  if (!state) return "";
  const plan = resolveDashboardPlan(state);
  const taskSignature = (plan?.tasks || [])
    .map((task) => `${task.id}:${task.dayIndex}:${task.homeroom ? 1 : 0}:${task.text}`)
    .join("|");

  const todoSignature = (state.todos || []).map((t) => `${t.id}:${t.dueDate}`).join("|");

  return JSON.stringify({
    activePlanId: state.activePlanId || "",
    publishedPlanId: state.publishedPlanId || "",
    settings: state.settings || {},
    taskSignature,
    todoSignature
  });
}

async function syncDashboardState() {
  const latest = await loadState();
  const latestSignature = buildStateSignature(latest);
  if (!latestSignature || latestSignature === stateSignature) return;

  dashboardState = latest;
  stateSignature = latestSignature;
  renderSettings();
  renderSchedule();
  renderDutyAndCleaning();
  renderRoles();
  renderSeating();
}

async function loadState() {
  try {
    const response = await fetch("/api/plans", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load plans");
    const parsed = await response.json();
    return {
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      activePlanId: parsed.activePlanId || null,
      publishedPlanId: parsed.publishedPlanId || null,
      settings: mergeSettings(parsed.settings),
      todos: Array.isArray(parsed.todos) ? parsed.todos : []
    };
  } catch {
    return { plans: [], activePlanId: null, publishedPlanId: null, settings: defaultSettings, todos: [] };
  }
}

function resolveDashboardPlan(state) {
  const preferred = state.publishedPlanId || state.activePlanId;
  return state.plans.find((p) => p.id === preferred) || null;
}

function getKoreaToday() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function weeksBetween(start, end) {
  return Math.floor((startOfWeek(end) - startOfWeek(start)) / (7 * 24 * 60 * 60 * 1000));
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addWeekdays(date, weekdays) {
  const copy = new Date(date);
  let remaining = weekdays;
  while (remaining > 0) {
    copy.setDate(copy.getDate() + 1);
    if (copy.getDay() !== 0 && copy.getDay() !== 6) remaining -= 1;
  }
  return copy;
}

function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function inferPlanWeekStart(plan) {
  const raw = `${plan?.title || ""} ${plan?.sourceFileName || ""}`;
  const year = Number((raw.match(/(20\d{2})/) || [])[1]) || getKoreaToday().getFullYear();
  const range = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*~\s*(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/);
  if (!range) return startOfWeek(getKoreaToday());
  return new Date(`${year}-${String(Number(range[1])).padStart(2, "0")}-${String(Number(range[2])).padStart(2, "0")}T00:00:00+09:00`);
}

function formatScheduleDayLabel(plan, dayIndex) {
  const date = addDays(inferPlanWeekStart(plan), dayIndex - 1);
  return `${formatMonthDay(date)} ${DAY_NAMES_LONG[dayIndex]}`;
}

function shortName(name) {
  return String(name || "").slice(1) || String(name || "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function normalizeRenderedMarkdown(html) {
  return String(html || "")
    .replace(/<a /g, '<a target="_blank" rel="noreferrer" ')
    .replace(/<p>([\s\S]*?)<\/p>/g, "<p>$1</p>");
}

function renderMarkdown(text, { inline = false } = {}) {
  const source = String(text || "");
  if (window.marked && window.DOMPurify) {
    const rawHtml = inline
      ? window.marked.parseInline(source, { breaks: true, gfm: true })
      : window.marked.parse(source, { breaks: true, gfm: true });
    const cleanHtml = window.DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });
    return normalizeRenderedMarkdown(cleanHtml);
  }

  return escapeHtml(source)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderLive() {
  const today = getKoreaToday();
  const dateEl = document.querySelector("#live-date");
  const dayEl = document.querySelector("#school-day");
  if (dateEl) dateEl.textContent = today.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  if (dayEl) {
    dayEl.textContent = `${DAY_NAMES[today.getDay()]}요일`;
    dayEl.dataset.short = DAY_NAMES[today.getDay()];
  }
}

function parseGvizResponse(text) {
  const match = String(text).match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?$/);
  if (!match) throw new Error("Invalid gviz response");
  return JSON.parse(match[1]);
}

function cellValue(cell) {
  if (!cell) return "-";
  const raw = cell.formattedValue ?? cell.v ?? "-";
  return String(raw).trim() || "-";
}

async function loadTodaySubjects() {
  try {
    const response = await fetch("/api/today-schedule", { cache: "no-store" });
    if (!response.ok) throw new Error("Schedule API failed");
    const data = await response.json();
    if (!Array.isArray(data.subjects)) throw new Error("Invalid schedule API response");
    todaySubjects = Array.from({ length: 7 }, (_, index) => String(data.subjects[index] || "-").trim() || "-");
    return;
  } catch {
    // Local static preview cannot run Vercel functions, so try the public sheet directly.
  }

  const url = `https://docs.google.com/spreadsheets/d/${TODAY_SHEET_ID}/gviz/tq?range=A1:G1&tqx=out:json`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Sheet request failed");
    const text = await response.text();
    const parsed = parseGvizResponse(text);
    const row = parsed?.table?.rows?.[0]?.c || [];
    todaySubjects = Array.from({ length: 7 }, (_, index) => cellValue(row[index]));
  } catch {
    todaySubjects = Array(7).fill("-");
  }
}

function minuteOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function periodInfo(now) {
  const nowMinute = minuteOfDay(now);
  const day = now.getDay();
  const activeRules = PERIOD_RULES.filter((rule) => !(rule.blockedWeekdays || []).includes(day));
  for (let i = 0; i < activeRules.length; i += 1) {
    const rule = activeRules[i];
    const start = rule.start[0] * 60 + rule.start[1];
    const end = rule.end[0] * 60 + rule.end[1];
    if (nowMinute >= start && nowMinute < end) {
      if (rule.key === "LUNCH") return "점심시간";
      const subject = todaySubjects[rule.subjectIndex] || "-";
      return `${rule.label} ${subject}`;
    }
    if (nowMinute < start) {
      return i === 0 ? "등교 전" : "쉬는 시간";
    }
  }
  return "방과후";
}

function currentPeriodKey(now) {
  const nowMinute = minuteOfDay(now);
  const day = now.getDay();
  const rule = PERIOD_RULES.find((item) => {
    if ((item.blockedWeekdays || []).includes(day)) return false;
    const start = item.start[0] * 60 + item.start[1];
    const end = item.end[0] * 60 + item.end[1];
    return nowMinute >= start && nowMinute < end;
  });
  return rule?.key || "";
}

function renderDailyTimetable() {
  const board = document.querySelector("#daily-timetable-board");
  if (!board) return;

  const now = getKoreaToday();
  const day = now.getDay();
  const activeKey = currentPeriodKey(now);
  const visibleRules = PERIOD_RULES.filter((rule) => rule.key !== "LUNCH");
  const nowMin = minuteOfDay(now);
  board.innerHTML = visibleRules.map((rule) => {
    const isBlocked = (rule.blockedWeekdays || []).includes(day);
    const subject = isBlocked ? "없음" : todaySubjects[rule.subjectIndex] || "-";
    if (!subject || subject === "-" || subject === "없음") return "";
    const isCurrent = activeKey === rule.key;
    const ruleStart = rule.start[0] * 60 + rule.start[1];
    const ruleEnd = rule.end[0] * 60 + rule.end[1];
    const prog = isCurrent ? Math.round(((nowMin - ruleStart) / (ruleEnd - ruleStart)) * 100) : 0;
    return `
      <div class="daily-period ${isCurrent ? "is-current" : ""} ${isBlocked ? "is-empty" : ""}">
        <span>${rule.key}.</span>
        <strong>${escapeHtml(subject)}</strong>
        ${isCurrent ? `<div class="period-progress"><div class="period-progress-fill" style="width:${prog}%"></div></div>` : ""}
      </div>`;
  }).join("");

  const label = document.querySelector("#daily-timetable-period");
  if (label) label.textContent = periodInfo(now);
}

async function loadMeal() {
  try {
    const response = await fetch("/api/meal", { cache: "no-store" });
    if (!response.ok) throw new Error("Meal API failed");
    mealState = await response.json();
  } catch {
    mealState = null;
  }
}

function renderMeal() {
  const board = document.querySelector("#meal-board");
  if (!board) return;

  const meals = mealState?.meals || [];
  if (!meals.length) {
    board.innerHTML = `<p class="meal-empty">오늘은 급식이 없습니다.</p>`;
    const calInline = document.querySelector("#meal-cal-inline");
    if (calInline) calInline.textContent = "";
    return;
  }

  const meal = meals[0];
  const calInline = document.querySelector("#meal-cal-inline");
  if (calInline) calInline.textContent = meal.calories ? meal.calories : "";
  board.innerHTML = `<ul class="meal-dishes">${meal.dishes.map((dish) => `<li>${escapeHtml(dish)}</li>`).join("")}</ul>`;
}

async function loadEnvironment() {
  try {
    const response = await fetch("/api/environment", { cache: "no-store" });
    if (!response.ok) throw new Error("Environment API failed");
    environmentState = await response.json();
  } catch {
    environmentState = null;
  }
}

function renderEnvironment() {
  const weatherTemp = document.querySelector("#weather-temp");
  const weatherDesc = document.querySelector("#weather-desc");
  const airQuality = document.querySelector("#air-quality");
  const airDetail = document.querySelector("#air-detail");
  if (!weatherTemp || !weatherDesc || !airQuality || !airDetail) return;

  const temperature = environmentState?.weather?.temperature;
  const pm25 = environmentState?.air?.pm25;
  const wIcon = environmentState?.weather?.icon || "";
  const aqLabel = environmentState?.air?.label || "--";
  weatherTemp.textContent = Number.isFinite(Number(temperature)) ? `${Math.round(Number(temperature))}°C` : "";
  weatherDesc.textContent = (wIcon ? wIcon + " " : "") + (environmentState?.weather?.label || "--");
  const aqColors = { "좋음": "var(--success)", "보통": "var(--amber)", "나쁨": "#ff9a3c", "매우나쁨": "var(--danger)" };
  const aqDots  = { "좋음": "🟢", "보통": "🟡", "나쁨": "🟠", "매우나쁨": "🔴" };
  airQuality.textContent = (aqDots[aqLabel] || "") + " " + aqLabel;
  airQuality.style.color = aqColors[aqLabel] || "";
  airDetail.textContent = Number.isFinite(Number(pm25)) ? `(${Math.round(Number(pm25))}μg/m³)` : "";
}

function updateDayProgress(now) {
  const nowMin = minuteOfDay(now || getKoreaToday());
  const dayStart = 8 * 60 + 20;
  const dayEnd = 15 * 60 + 50;
  const barEl = document.querySelector("#day-progress-bar");
  const pctEl = document.querySelector("#day-progress-pct");
  if (!barEl || !pctEl) return;
  let pct = 0;
  if (nowMin <= dayStart) pct = 0;
  else if (nowMin >= dayEnd) pct = 100;
  else pct = Math.round(((nowMin - dayStart) / (dayEnd - dayStart)) * 100);
  barEl.style.width = pct + "%";
  pctEl.textContent = pct + "%";
}

function getCountdownInfo(now) {
  const nowMin = minuteOfDay(now);
  const secs = now.getSeconds();
  const day = now.getDay();
  const activeRules = PERIOD_RULES.filter((r) => !(r.blockedWeekdays || []).includes(day) && r.key !== "LUNCH");
  for (const rule of activeRules) {
    const start = rule.start[0] * 60 + rule.start[1];
    if (start - nowMin === 1) {
      const secsLeft = 60 - secs;
      if (secsLeft > 0) return { secsLeft, subject: todaySubjects[rule.subjectIndex] || rule.label };
    }
  }
  return null;
}

function renderNowPanel() {
  const now = getKoreaToday();
  const clock = now.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
  const clockEl = document.querySelector("#current-clock");
  const classEl = document.querySelector("#current-class-status");
  const nowPanel = document.querySelector(".now-panel");
  if (clockEl) clockEl.textContent = clock;
  const countdown = getCountdownInfo(now);
  if (countdown) {
    nowPanel?.classList.add("is-countdown");
    if (classEl) classEl.innerHTML = `<span>⏰ ${countdown.secsLeft}초 후</span><strong>${escapeHtml(countdown.subject)} 시작</strong>`;
  } else {
    nowPanel?.classList.remove("is-countdown");
    const status = periodInfo(now);
    if (classEl) {
      const match = status.match(/^([0-9]+교시)\s+(.+)$/);
      classEl.innerHTML = match
        ? `<span>${escapeHtml(match[1])}</span><strong>${escapeHtml(match[2])}</strong>`
        : `<strong>${escapeHtml(status)}</strong>`;
    }
  }
  updateDayProgress(now);
  renderDailyTimetable();
}

function renderSettings() {
  const { teacher, messages, quickLinks } = dashboardState.settings;
  document.querySelector("#teacher-message-title").innerHTML = renderMarkdown(messages.teacherTitle, { inline: true });
  document.querySelector("#teacher-message-body").innerHTML = renderMarkdown(messages.teacherBody);
  document.querySelector("#daily-quote").innerHTML = renderMarkdown(messages.quote);
  document.querySelector("#teacher-name").textContent = teacher.name;
  document.querySelector("#teacher-subject").textContent = teacher.subject || "-";
  document.querySelector("#teacher-office").textContent = teacher.office || "-";
  document.querySelector("#teacher-phone").innerHTML = teacher.phone ? `<a href="tel:${escapeHtml(teacher.phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(teacher.phone)}</a>` : "-";
  document.querySelector("#teacher-instagram").innerHTML = teacher.instagramUrl ? `<a href="${escapeHtml(teacher.instagramUrl)}" target="_blank" rel="noreferrer">${escapeHtml(teacher.instagram || teacher.instagramUrl)}</a>` : escapeHtml(teacher.instagram || "-");
  document.querySelector("#compact-links").innerHTML = quickLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("");
}

function weekOffsetLabel(offset) {
  if (offset === 0) return "이번 주";
  if (offset === 1) return "다음 주";
  if (offset === -1) return "저번 주";
  return offset > 0 ? `${offset}주 후` : `${Math.abs(offset)}주 전`;
}

function renderSchedule() {
  const plan = resolveDashboardPlan(dashboardState);
  const today = getKoreaToday().getDay();
  const homeroomTasks = weekOffset === 0 && plan ? plan.tasks.filter((t) => t.homeroom) : [];
  const todos = dashboardState.todos || [];
  const board = document.querySelector("#schedule-board");
  const weekStart = addDays(inferPlanWeekStart(plan), weekOffset * 7);

  const offsetLabel = document.querySelector("#week-offset-label");
  if (offsetLabel) offsetLabel.textContent = weekOffsetLabel(weekOffset);

  board.innerHTML = [1, 2, 3, 4, 5].map((dayIndex) => {
    const tasks = homeroomTasks.filter((task) => task.dayIndex === dayIndex);
    const rows = tasks.length ? tasks : (weekOffset === 0 && !plan && dayIndex === today ? fallbackSchedules[today] || [] : []);
    const isToday = weekOffset === 0 && dayIndex === today;
    const dayDate = addDays(weekStart, dayIndex - 1);
    const dayTodos = todos.filter((todo) => todo.dueDate === isoDate(dayDate));
    const empty = !rows.length && !dayTodos.length;
    const dayLabel = `${formatMonthDay(dayDate)} ${DAY_NAMES_LONG[dayIndex]}`;

    return `
      <section class="schedule-day ${isToday ? "is-today" : ""}">
        <div class="schedule-day-head"><span>${dayLabel}</span><strong>${rows.length + dayTodos.length}</strong></div>
        <ul>
          ${dayTodos.map((todo) => `
            <li class="todo-item">
              ${todo.period ? `<span>${escapeHtml(todo.period)}교시</span>` : ""}
              <strong>${escapeHtml((todo.subject ? `[${todo.subject}] ` : "") + todo.task)}</strong>
            </li>`).join("")}
          ${empty ? `<li class="empty-day">추가 일정 없음</li>` : rows.map((task) => {
            const text = Array.isArray(task) ? task[1] : task.text;
            const time = Array.isArray(task) ? task[0] : "";
            return `<li>${time ? `<span>${escapeHtml(time)}</span>` : ""}<strong>${escapeHtml(text)}</strong></li>`;
          }).join("")}
        </ul>
      </section>`;
  }).join("");

  const maxDayCount = Math.max(...[1, 2, 3, 4, 5].map((dayIndex) => homeroomTasks.filter((task) => task.dayIndex === dayIndex).length), 0);
  board.classList.toggle("is-dense", maxDayCount > 9);
}

function initScheduleNav() {
  document.querySelector("#schedule-prev")?.addEventListener("click", () => {
    weekOffset -= 1;
    renderSchedule();
  });
  document.querySelector("#schedule-next")?.addEventListener("click", () => {
    weekOffset += 1;
    renderSchedule();
  });
}

function getDutyInfo() {
  const today = getKoreaToday();
  const dutyAnchor = new Date("2026-08-24T00:00:00+09:00");
  const dutyWeek = Math.max(0, weeksBetween(dutyAnchor, today));
  const dutyBaseIndex = Math.max(0, students.indexOf(DUTY_BASE_START_NAME));
  const dutyStart = (dutyBaseIndex + dutyWeek * 2) % students.length;
  const nextDutyStart = (dutyBaseIndex + (dutyWeek + 1) * 2) % students.length;
  return {
    pair: [students[dutyStart], students[(dutyStart + 1) % students.length]],
    nextPair: [students[nextDutyStart], students[(nextDutyStart + 1) % students.length]]
  };
}

function renderDutyAndCleaning() {
  const { pair, nextPair } = getDutyInfo();
  document.querySelector("#duty-card").innerHTML = `<p class="duty-label">이번 주 주번</p><div class="duty-pair">${pair.map((name) => `<span>${shortName(name)}</span>`).join("")}</div><p>다음 주: ${nextPair.map(shortName).join(", ")}</p>`;

  const today = getKoreaToday();
  const cleaningPeriods = [
    { start: new Date("2026-05-28T00:00:00+09:00"), end: new Date("2026-06-05T00:00:00+09:00") },
    { start: new Date("2026-06-08T00:00:00+09:00"), end: new Date("2026-06-19T00:00:00+09:00") },
  ];
  const lastPeriod = cleaningPeriods[cleaningPeriods.length - 1];
  let cycle, periodStart, periodEnd;
  if (today < cleaningPeriods[0].start) {
    cycle = 0; periodStart = cleaningPeriods[0].start; periodEnd = cleaningPeriods[0].end;
  } else {
    cycle = cleaningPeriods.length - 1;
    periodStart = lastPeriod.start; periodEnd = lastPeriod.end;
    for (let i = 0; i < cleaningPeriods.length - 1; i++) {
      if (today < cleaningPeriods[i + 1].start) {
        cycle = i; periodStart = cleaningPeriods[i].start; periodEnd = cleaningPeriods[i].end; break;
      }
    }
    const extra = Math.floor((today - lastPeriod.start) / (14 * 24 * 60 * 60 * 1000));
    if (extra > 0) {
      cycle = cleaningPeriods.length - 1 + extra;
      periodStart = addDays(lastPeriod.start, extra * 14);
      periodEnd = addDays(periodStart, 14);
    }
  }
  document.querySelector("#cleaning-period").textContent = `${formatMonthDay(periodStart)} - ${formatMonthDay(periodEnd)}`;
  const baseStartIndex = Math.max(0, students.indexOf(CLEANING_BASE_START_NAME));
  document.querySelector("#cleaning-grid").innerHTML = cleaningAssignments
    .map((name, idx) => {
      const studentIndex = (idx + baseStartIndex - cycle * 3 + students.length * 100) % students.length;
      return `<div class="assignment"><strong>${name}</strong><span>${shortName(students[studentIndex])}</span></div>`;
    })
    .join("");
}

function renderRoles() {
  document.querySelector("#roles-list").innerHTML = dashboardState.settings.roles
    .map(([role, student], index) => `<article class="role-item"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(role)}</strong><p>${escapeHtml(shortName(student))}</p></article>`)
    .join("");
}

function renderSeating() {
  const chart = document.querySelector("#seating-chart");
  chart.innerHTML = `
    <div class="fixture teacher-desk">교탁</div>
    ${dashboardState.settings.seatingRows.map((row) => `<div class="seat-row">${row.map((name) => `<div class="seat"><span>${escapeHtml(shortName(name))}</span></div>`).join("")}</div>`).join("")}
    <div class="fixture door-zone">출입문</div>
  `;
}

function setActiveView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
}

function initViewTabs() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view);
      if (window.matchMedia("(max-width: 920px)").matches) {
        document.querySelector(`[data-view-panel="${button.dataset.view}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

async function init() {
  renderLive();
  await Promise.all([loadTodaySubjects(), loadEnvironment(), loadMeal()]);
  dashboardState = await loadState();
  stateSignature = buildStateSignature(dashboardState);
  renderSettings();
  renderSchedule();
  renderDutyAndCleaning();
  renderRoles();
  renderSeating();
  renderDailyTimetable();
  renderNowPanel();
  renderEnvironment();
  renderMeal();
  window.setInterval(() => {
    renderLive();
    renderNowPanel();
  }, 1000);
  window.setInterval(async () => {
    await loadEnvironment();
    renderEnvironment();
  }, 5 * 60 * 1000);
  window.setInterval(async () => {
    await loadMeal();
    renderMeal();
  }, 60 * 60 * 1000);
  window.setInterval(() => {
    syncDashboardState().catch(() => {});
  }, 10 * 1000);
  initViewTabs();
  initScheduleNav();
}

init();
