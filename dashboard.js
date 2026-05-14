const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_NAMES_LONG = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일" };
const VIEW_ORDER = ["schedule", "duties", "roles", "seating"];

const students = ["고성민", "고희경", "권율", "김규리", "김선민", "박지성", "변지현", "여서정", "유리한", "윤규태", "이윤재", "이현민", "전효민", "조예지", "최승우", "최영민", "한병민", "황수미"];
const cleaningAssignments = ["쓸기1", "쓸기2", "쓸기3", "바닦1", "바닦2", "휴지통1", "휴지통2", "닦기1", "닦기2", "닦기3", "닦기4", "교탁정리", "꿈담카페1", "꿈담카페2", "꿈담카페3", "2-2계단1", "2-2계단2", "2-2계단3"];
const defaultRoles = [
  ["학급 회장", "고성민"], ["학급 부회장", "고희경"], ["출석 확인", "권율"], ["알림장", "김규리"], ["과제 리마인더", "김선민"], ["기자재 점검", "박지성"],
  ["칠판 관리", "변지현"], ["분리수거", "여서정"], ["학습 분위기", "유리한"], ["문단속", "윤규태"], ["환기", "이윤재"], ["사물함 점검", "이현민"],
  ["급식 안내", "전효민"], ["게시판", "조예지"], ["체육 준비", "최승우"], ["도서 관리", "최영민"], ["행사 기록", "한병민"], ["칭찬 릴레이", "황수미"]
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

function mergeSettings(settings = {}) {
  return {
    teacher: { ...defaultSettings.teacher, ...(settings.teacher || {}) },
    messages: { ...defaultSettings.messages, ...(settings.messages || {}) },
    quickLinks: Array.isArray(settings.quickLinks) && settings.quickLinks.length ? settings.quickLinks : defaultSettings.quickLinks,
    roles: Array.isArray(settings.roles) && settings.roles.length ? settings.roles : defaultSettings.roles,
    seatingRows: Array.isArray(settings.seatingRows) && settings.seatingRows.length ? settings.seatingRows : defaultSettings.seatingRows
  };
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
      settings: mergeSettings(parsed.settings)
    };
  } catch {
    return { plans: [], activePlanId: null, publishedPlanId: null, settings: defaultSettings };
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

function renderLive() {
  const today = getKoreaToday();
  document.querySelector("#live-date").textContent = today.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  document.querySelector("#school-day").textContent = `${DAY_NAMES[today.getDay()]}요일`;
}

function renderSettings() {
  const { teacher, messages, quickLinks } = dashboardState.settings;
  document.querySelector("#teacher-message-title").textContent = messages.teacherTitle;
  document.querySelector("#teacher-message-body").textContent = messages.teacherBody;
  document.querySelector("#daily-quote").textContent = messages.quote;
  document.querySelector("#teacher-name").textContent = teacher.name;
  document.querySelector("#teacher-subject").textContent = teacher.subject || "-";
  document.querySelector("#teacher-office").textContent = teacher.office || "-";
  document.querySelector("#teacher-phone").innerHTML = teacher.phone ? `<a href="tel:${escapeHtml(teacher.phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(teacher.phone)}</a>` : "-";
  document.querySelector("#teacher-instagram").innerHTML = teacher.instagramUrl ? `<a href="${escapeHtml(teacher.instagramUrl)}" target="_blank" rel="noreferrer">${escapeHtml(teacher.instagram || teacher.instagramUrl)}</a>` : escapeHtml(teacher.instagram || "-");
  document.querySelector("#compact-links").innerHTML = quickLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("");
}

function renderSchedule() {
  const plan = resolveDashboardPlan(dashboardState);
  const today = getKoreaToday().getDay();
  const homeroomTasks = plan ? plan.tasks.filter((t) => t.homeroom) : [];
  const board = document.querySelector("#schedule-board");

  board.innerHTML = [1, 2, 3, 4, 5].map((dayIndex) => {
    const tasks = homeroomTasks.filter((task) => task.dayIndex === dayIndex);
    const rows = tasks.length ? tasks : (dayIndex === today ? fallbackSchedules[today] || [] : []);
    const isToday = dayIndex === today;
    const empty = !rows.length;

    return `
      <section class="schedule-day ${isToday ? "is-today" : ""}">
        <div class="schedule-day-head"><span>${formatScheduleDayLabel(plan, dayIndex)}</span><strong>${rows.length}</strong></div>
        <ul>
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

function getDutyInfo() {
  const today = getKoreaToday();
  const dutyAnchor = new Date("2026-05-11T00:00:00+09:00");
  const dutyWeek = Math.max(0, weeksBetween(dutyAnchor, today));
  const dutyStart = (dutyWeek * 2) % students.length;
  const nextDutyStart = ((dutyWeek + 1) * 2) % students.length;
  return {
    pair: [students[dutyStart], students[(dutyStart + 1) % students.length]],
    nextPair: [students[nextDutyStart], students[(nextDutyStart + 1) % students.length]]
  };
}

function renderDutyAndCleaning() {
  const { pair, nextPair } = getDutyInfo();
  document.querySelector("#duty-card").innerHTML = `<p class="duty-label">이번 주 주번</p><div class="duty-pair">${pair.map((name) => `<span>${shortName(name)}</span>`).join("")}</div><p>다음 주: ${nextPair.map(shortName).join(", ")}</p>`;

  const today = getKoreaToday();
  const cleanAnchor = new Date("2026-05-28T00:00:00+09:00");
  const cycle = Math.max(0, Math.floor((startOfWeek(today) - startOfWeek(cleanAnchor)) / (14 * 24 * 60 * 60 * 1000)));
  const start = addDays(cleanAnchor, cycle * 14);
  const end = addWeekdays(start, 6);
  document.querySelector("#cleaning-period").textContent = `${formatMonthDay(start)} - ${formatMonthDay(end)}`;
  document.querySelector("#cleaning-grid").innerHTML = cleaningAssignments
    .map((name, idx) => {
      const studentIndex = (idx - cycle * 3 + students.length * 10) % students.length;
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

function initViewRotation() {
  let currentIndex = 0;
  let rotationTimer = null;

  const restart = () => {
    window.clearInterval(rotationTimer);
    if (window.matchMedia("(max-width: 920px)").matches) return;
    rotationTimer = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % VIEW_ORDER.length;
      setActiveView(VIEW_ORDER[currentIndex]);
    }, 5000);
  };

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentIndex = VIEW_ORDER.indexOf(button.dataset.view);
      setActiveView(button.dataset.view);
      restart();
      if (window.matchMedia("(max-width: 920px)").matches) {
        document.querySelector(`[data-view-panel="${button.dataset.view}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  restart();
  window.matchMedia("(max-width: 920px)").addEventListener("change", restart);
}

async function init() {
  renderLive();
  dashboardState = await loadState();
  renderSettings();
  renderSchedule();
  renderDutyAndCleaning();
  renderRoles();
  renderSeating();
  initViewRotation();
}

init();
