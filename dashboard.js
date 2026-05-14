const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_NAMES_LONG = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일" };

const students = ["고성민", "고희경", "권율", "김규리", "김선민", "박지성", "변지현", "여서정", "유리한", "윤규태", "이윤재", "이현민", "전효민", "조예지", "최승우", "최영민", "한병민", "황수미"];
const cleaningAssignments = ["쓸기1", "쓸기2", "쓸기3", "바닦1", "바닦2", "휴지통1", "휴지통2", "닦기1", "닦기2", "닦기3", "닦기4", "교탁정리", "꿈담카페1", "꿈담카페2", "꿈담카페3", "2-2계단1", "2-2계단2", "2-2계단3"];

const fallbackSchedules = {
  1: [["08:05", "주번 조회"], ["1교시", "자치활동"]],
  2: [["08:10", "조회"], ["16:30", "방과후학교 A"], ["18:20", "방과후학교 B"]],
  3: [["6-7교시", "멘토링"], ["청소 전", "교실 준비"]],
  4: [["3교시 후", "일과 조정"], ["종례 전", "교실 점검"]],
  5: [["16:30", "방과후학교 A"], ["종례", "주간 정리"]]
};

async function loadState() {
  try {
    const response = await fetch("/api/plans", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load plans");
    const parsed = await response.json();
    return {
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      activePlanId: parsed.activePlanId || null,
      publishedPlanId: parsed.publishedPlanId || null
    };
  } catch {
    return { plans: [], activePlanId: null, publishedPlanId: null };
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

function shortName(name) {
  return name.slice(1);
}

function renderLive() {
  const today = getKoreaToday();
  document.querySelector("#live-date").textContent = today.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  document.querySelector("#school-day").textContent = `${DAY_NAMES[today.getDay()]}요일`;
}

async function renderSchedule() {
  const state = await loadState();
  const plan = resolveDashboardPlan(state);
  const today = getKoreaToday().getDay();
  const todayList = document.querySelector("#today-list");
  const upcomingList = document.querySelector("#upcoming-list");
  const homeroomTasks = plan ? plan.tasks.filter((t) => t.homeroom) : [];
  const todayTasks = homeroomTasks.filter((t) => t.dayIndex === today);

  if (todayTasks.length) {
    todayList.innerHTML = todayTasks.map((task, idx) => `<li class="${idx === 0 ? "is-highlight" : ""}"><span class="task-time">${DAY_NAMES_LONG[task.dayIndex] || `${task.dayIndex}일`}</span><strong>${task.text}</strong></li>`).join("");
  } else {
    const fallback = fallbackSchedules[today] || [["오늘", "등록된 일정 없음"]];
    todayList.innerHTML = fallback.map((f, idx) => `<li class="${idx === 0 ? "is-highlight" : ""}"><span class="task-time">${f[0]}</span><strong>${f[1]}</strong></li>`).join("");
  }

  if (homeroomTasks.length) {
    upcomingList.innerHTML = homeroomTasks
      .filter((t) => t.dayIndex >= today)
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((task) => `<li><span class="task-time">${DAY_NAMES_LONG[task.dayIndex] || `${task.dayIndex}일`}</span><strong>${task.text}</strong></li>`)
      .join("");
  } else {
    upcomingList.innerHTML = `<li><strong>아직 저장된 반영 일정이 없습니다. 관리 페이지에서 체크 후 저장하세요.</strong></li>`;
  }
}

function renderDutyAndCleaning() {
  const today = getKoreaToday();
  const dutyAnchor = new Date("2026-05-11T00:00:00+09:00");
  const dutyWeek = Math.max(0, weeksBetween(dutyAnchor, today));
  const dutyStart = (dutyWeek * 2) % students.length;
  const pair = [students[dutyStart], students[(dutyStart + 1) % students.length]];
  const nextDutyStart = ((dutyWeek + 1) * 2) % students.length;
  const nextPair = [students[nextDutyStart], students[(nextDutyStart + 1) % students.length]];
  document.querySelector("#duty-card").innerHTML = `<div class="duty-pair">${pair.map((n) => `<span>${shortName(n)}</span>`).join("")}</div><p>다음 주: ${nextPair.map(shortName).join(", ")}</p>`;

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

function renderRoster() {
  document.querySelector("#roster-list").innerHTML = students.map((name, i) => `<li><strong>${name}</strong><span>${i + 1}</span></li>`).join("");
}

function autoFlow(selector, step = 1, interval = 2400) {
  if (window.matchMedia("(max-width: 920px)").matches) return;
  const el = document.querySelector(selector);
  if (!el) return;
  if (el.scrollHeight <= el.clientHeight + 2) return;

  let index = 0;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  setInterval(() => {
    index += step * 28;
    if (index > max) index = 0;
    el.scrollTo({ top: index, behavior: "smooth" });
  }, interval);
}

async function init() {
  renderLive();
  await renderSchedule();
  renderDutyAndCleaning();
  renderRoster();
  autoFlow("#today-list", 1, 2600);
  autoFlow("#upcoming-list", 1, 4200);
  autoFlow("#cleaning-grid", 1, 2400);
  autoFlow("#roster-list", 1, 2200);
}

init();
