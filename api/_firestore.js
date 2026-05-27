const admin = require("firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "class2-dashboard";
const CONFIG_REF = ["app", "class2-dashboard"];

function serviceAccountCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw) return admin.credential.applicationDefault();

  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const json = JSON.parse(text);
  if (json.private_key) json.private_key = json.private_key.replace(/\\n/g, "\n");
  return admin.credential.cert(json);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: serviceAccountCredential(),
    projectId: PROJECT_ID
  });
}

const db = admin.firestore();

const DEFAULT_SETTINGS = {
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

function sanitizeSettings(settings = {}) {
  const teacher = { ...DEFAULT_SETTINGS.teacher, ...(settings.teacher || {}) };
  const messages = { ...DEFAULT_SETTINGS.messages, ...(settings.messages || {}) };
  const quickLinks = Array.isArray(settings.quickLinks) ? settings.quickLinks : DEFAULT_SETTINGS.quickLinks;
  const roles = Array.isArray(settings.roles) ? settings.roles : DEFAULT_SETTINGS.roles;
  const seatingRows = Array.isArray(settings.seatingRows) ? settings.seatingRows : DEFAULT_SETTINGS.seatingRows;

  return {
    teacher: {
      name: String(teacher.name || DEFAULT_SETTINGS.teacher.name).trim(),
      subject: String(teacher.subject || "").trim(),
      office: String(teacher.office || "").trim(),
      phone: String(teacher.phone || "").trim(),
      instagram: String(teacher.instagram || "").trim(),
      instagramUrl: String(teacher.instagramUrl || "").trim()
    },
    messages: {
      teacherTitle: String(messages.teacherTitle || "").trim(),
      teacherBody: String(messages.teacherBody || "").trim(),
      quote: String(messages.quote || "").trim()
    },
    quickLinks: quickLinks
      .map((link) => ({ label: String(link?.label || "").trim(), url: String(link?.url || "").trim() }))
      .filter((link) => link.label && link.url)
      .slice(0, 6),
    roles: roles
      .map((row) => Array.isArray(row) ? [String(row[0] || "").trim(), String(row[1] || "").trim()] : [String(row?.role || "").trim(), String(row?.student || "").trim()])
      .filter(([role, student]) => role && student)
      .slice(0, 24),
    seatingRows: seatingRows
      .map((row) => {
        const names = Array.isArray(row) ? row : row?.students;
        return Array.isArray(names) ? names.map((name) => String(name || "").trim()).filter(Boolean).slice(0, 8) : [];
      })
      .filter((row) => row.length)
      .slice(0, 6)
  };
}

function pruneTodos(todos) {
  if (!Array.isArray(todos)) return [];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const cutoff = new Date(today + "T00:00:00+09:00");
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return todos.filter((t) => !t.dueDate || t.dueDate >= cutoffStr);
}

function settingsForFirestore(settings) {
  const clean = sanitizeSettings(settings);
  return {
    ...clean,
    roles: clean.roles.map(([role, student]) => ({ role, student })),
    seatingRows: clean.seatingRows.map((students) => ({ students }))
  };
}

function planRef(planId) {
  return db.collection("plans").doc(planId);
}

function taskRef(planId, taskId) {
  return planRef(planId).collection("tasks").doc(taskId);
}

async function getConfig() {
  const snap = await db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]).get();
  const data = snap.exists ? snap.data() : {};
  return {
    activePlanId: data.activePlanId || null,
    publishedPlanId: data.publishedPlanId || null,
    settings: sanitizeSettings(data.settings || DEFAULT_SETTINGS),
    todos: pruneTodos(data.todos)
  };
}

async function listPlans() {
  const [config, planSnaps] = await Promise.all([
    getConfig(),
    db.collection("plans").orderBy("createdAt", "desc").limit(20).get()
  ]);

  const plans = [];
  for (const doc of planSnaps.docs) {
    const data = doc.data();
    const taskSnaps = await doc.ref.collection("tasks").orderBy("order").get();
    plans.push({
      id: doc.id,
      title: data.title || "Untitled plan",
      createdAt: data.createdAt || null,
      sourceFileName: data.sourceFileName || "",
      parserName: data.parserName || "",
      tasks: taskSnaps.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }))
    });
  }

  return { plans, ...config };
}

async function createPlan({ title, sourceFileName, parserName, tasks }) {
  const now = new Date().toISOString();
  const ref = db.collection("plans").doc();
  const batch = db.batch();
  const existingPlans = await db.collection("plans").get();

  for (const planDoc of existingPlans.docs) {
    const taskSnaps = await planDoc.ref.collection("tasks").get();
    taskSnaps.docs.forEach((taskDoc) => batch.delete(taskDoc.ref));
    batch.delete(planDoc.ref);
  }

  batch.set(ref, {
    title,
    sourceFileName: sourceFileName || title,
    parserName: parserName || "",
    createdAt: now,
    updatedAt: now
  });

  tasks.forEach((task, index) => {
    const taskDoc = ref.collection("tasks").doc();
    batch.set(taskDoc, {
      dayIndex: Number(task.dayIndex) || 0,
      text: String(task.text || "").trim(),
      homeroom: Boolean(task.homeroom),
      order: index,
      createdAt: now,
      updatedAt: now
    });
  });

  batch.set(
    db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]),
    { activePlanId: ref.id, publishedPlanId: null, updatedAt: now },
    { merge: true }
  );
  await batch.commit();
  return listPlans();
}

async function setActivePlan(planId) {
  await db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]).set(
    { activePlanId: planId || null, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return listPlans();
}

async function publishPlan(planId) {
  await db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]).set(
    { activePlanId: planId || null, publishedPlanId: planId || null, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return listPlans();
}

async function toggleTask(planId, taskId, homeroom) {
  await taskRef(planId, taskId).set(
    { homeroom: Boolean(homeroom), updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return listPlans();
}

async function editTask(planId, taskId, text) {
  await taskRef(planId, taskId).set(
    { text: String(text || "").trim(), updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return listPlans();
}

async function deleteTask(planId, taskId) {
  await taskRef(planId, taskId).delete();
  return listPlans();
}

async function addTask(planId, dayIndex, text) {
  const now = new Date().toISOString();
  const existing = await planRef(planId).collection("tasks").orderBy("order", "desc").limit(1).get();
  const nextOrder = existing.empty ? 0 : (existing.docs[0].data().order || 0) + 1;
  const ref = planRef(planId).collection("tasks").doc();
  await ref.set({
    dayIndex: Number(dayIndex) || 0,
    text: String(text || "").trim(),
    homeroom: false,
    order: nextOrder,
    createdAt: now,
    updatedAt: now
  });
  return listPlans();
}

async function updateSettings(settings) {
  await db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]).set(
    { settings: settingsForFirestore(settings), updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return listPlans();
}

async function addTodo(todo) {
  const now = new Date().toISOString();
  const clean = {
    id: String(todo.id || "").trim() || require("crypto").randomUUID(),
    dueDate: String(todo.dueDate || "").trim(),
    period: String(todo.period || "").trim(),
    subject: String(todo.subject || "").trim(),
    task: String(todo.task || "").trim(),
    createdAt: now
  };
  if (!clean.dueDate || !clean.task) throw new Error("dueDate and task are required");
  const ref = db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]);
  const snap = await ref.get();
  const current = pruneTodos(snap.data()?.todos);
  await ref.set({ todos: [...current, clean], updatedAt: now }, { merge: true });
  return listPlans();
}

async function deleteTodo(todoId) {
  const now = new Date().toISOString();
  const ref = db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]);
  const snap = await ref.get();
  const current = pruneTodos(snap.data()?.todos);
  await ref.set({ todos: current.filter((t) => t.id !== String(todoId)), updatedAt: now }, { merge: true });
  return listPlans();
}

module.exports = {
  createPlan,
  listPlans,
  publishPlan,
  setActivePlan,
  toggleTask,
  editTask,
  deleteTask,
  addTask,
  updateSettings,
  addTodo,
  deleteTodo,
  DEFAULT_SETTINGS
};
