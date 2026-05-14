const STORAGE_KEY = "class2_weekly_plans_v2";
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_NAMES_LONG = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일" };

const students = ["고성민", "고희경", "권율", "김규리", "김선민", "박지성", "변지현", "여서정", "유리한", "윤규태", "이윤재", "이현민", "전효민", "조예지", "최승우", "최영민", "한병민", "황수미"];
const dutyRotation = [["고성민", "고희경"], ["최영민", "최승우"], ["김규리", "김선민"], ["유리한", "이윤재"], ["변지현", "한병민"], ["전효민", "황수미"], ["권율", "박지성"], ["여서정", "윤규태"], ["이현민", "조예지"]];
const cleaningAssignments = ["쓸기 왼쪽", "쓸기 오른쪽", "쓸기 앞/뒤", "바닥 왼쪽", "바닥 오른쪽", "휴지통 1", "휴지통 2", "닦기 1", "닦기 2", "닦기 3", "닦기 4", "교탁 정리", "꿈담카페 1", "꿈담카페 2", "꿈담카페 3", "계단 1", "계단 2", "계단 3"];

const fallbackSchedules = {
  1: [["08:05", "주번 조회"], ["1교시", "자치활동"]],
  2: [["08:10", "조회"], ["16:30", "방과후학교 A"], ["18:20", "방과후학교 B"]],
  3: [["6-7교시", "멘토링"], ["청소 전", "교실 준비"]],
  4: [["3교시 후", "일과 조정"], ["종례 전", "교실 점검"]],
  5: [["16:30", "방과후학교 A"], ["종례", "주간 정리"]]
};

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

function currentPlan(state) {
  return state.plans.find((p) => p.id === state.activePlanId) || null;
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

function rotateArray(items, steps) {
  return items.map((_, index) => items[(index + steps) % items.length]);
}

function renderLive() {
  const today = getKoreaToday();
  document.querySelector("#live-date").textContent = today.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  document.querySelector("#school-day").textContent = `${DAY_NAMES[today.getDay()]}요일`;
}

function renderSchedule() {
  const state = loadState();
  const plan = currentPlan(state);
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
      .slice(0, 8)
      .map((task) => `<li><span class="task-time">${DAY_NAMES_LONG[task.dayIndex] || `${task.dayIndex}일`}</span><strong>${task.text}</strong></li>`)
      .join("");
  } else {
    upcomingList.innerHTML = `<li><strong>아직 체크된 2반 일정이 없습니다. 관리 페이지에서 항목을 선택해 주세요.</strong></li>`;
  }
}

function renderDutyAndCleaning() {
  const today = getKoreaToday();
  const dutyAnchor = new Date("2026-04-27T00:00:00+09:00");
  const dutyWeek = Math.max(0, weeksBetween(dutyAnchor, today));
  const pair = dutyRotation[dutyWeek % dutyRotation.length];
  const nextPair = dutyRotation[(dutyWeek + 1) % dutyRotation.length];
  document.querySelector("#duty-card").innerHTML = `<div class="duty-pair">${pair.map((n) => `<span>${n}</span>`).join("")}</div><p>다음 주: ${nextPair.join(", ")}</p>`;

  const cleanAnchor = new Date("2026-05-11T00:00:00+09:00");
  const cycle = Math.max(0, Math.floor((today - cleanAnchor) / (14 * 24 * 60 * 60 * 1000)));
  const start = addDays(cleanAnchor, cycle * 14);
  const end = addDays(start, 13);
  document.querySelector("#cleaning-period").textContent = `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
  const rotated = rotateArray(students, cycle);
  document.querySelector("#cleaning-grid").innerHTML = cleaningAssignments.map((name, idx) => `<div class="assignment"><strong>${name} · ${rotated[idx % rotated.length]}</strong></div>`).join("");
}

function renderRoster() {
  document.querySelector("#roster-list").innerHTML = students.map((name, i) => `<li><strong>${name}</strong><span>${i + 1}</span></li>`).join("");
}

function autoFlow(selector, step = 1, interval = 2400) {
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

function init() {
  renderLive();
  renderSchedule();
  renderDutyAndCleaning();
  renderRoster();
  autoFlow("#today-list", 1, 2600);
  autoFlow("#upcoming-list", 1, 2800);
  autoFlow("#cleaning-grid", 1, 2400);
  autoFlow("#roster-list", 1, 2200);
}

init();
