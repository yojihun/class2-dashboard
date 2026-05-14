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
    publishedPlanId: data.publishedPlanId || null
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

module.exports = {
  createPlan,
  listPlans,
  publishPlan,
  setActivePlan,
  toggleTask
};
