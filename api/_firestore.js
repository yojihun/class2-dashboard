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
    ["학급 회장", "고성민"], ["학급 부회장", "고희경"], ["출석 확인", "권율"], ["알림장", "김규리"], ["과제 리마인더", "김선민"], ["기자재 점검", "박지성"],
    ["칠판 관리", "변지현"], ["분리수거", "여서정"], ["학습 분위기", "유리한"], ["문단속", "윤규태"], ["환기", "이윤재"], ["사물함 점검", "이현민"],
    ["급식 안내", "전효민"], ["게시판", "조예지"], ["체육 준비", "최승우"], ["도서 관리", "최영민"], ["행사 기록", "한병민"], ["칭찬 릴레이", "황수미"]
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
    settings: sanitizeSettings(data.settings || DEFAULT_SETTINGS)
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

async function updateSettings(settings) {
  await db.collection(CONFIG_REF[0]).doc(CONFIG_REF[1]).set(
    { settings: settingsForFirestore(settings), updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return listPlans();
}

module.exports = {
  createPlan,
  listPlans,
  publishPlan,
  setActivePlan,
  toggleTask,
  updateSettings,
  DEFAULT_SETTINGS
};
