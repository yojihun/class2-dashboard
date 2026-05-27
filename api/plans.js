const { createPlan, listPlans, publishPlan, setActivePlan, toggleTask, editTask, deleteTask, addTask, updateSettings, addTodo, deleteTodo } = require("./_firestore");

function sendJson(res, status, body) {
  res.status(status).json(body);
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      sendJson(res, 200, await listPlans());
      return;
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      const tasks = Array.isArray(body.tasks) ? body.tasks : [];
      const validTasks = tasks.filter((task) => task && task.dayIndex && task.text);
      if (!title || !validTasks.length) {
        sendJson(res, 400, { error: "Plan title and tasks are required." });
        return;
      }
      sendJson(res, 201, await createPlan({ ...body, title, tasks: validTasks }));
      return;
    }

    if (req.method === "PATCH") {
      const body = req.body || {};
      if (body.action === "setActivePlan") {
        sendJson(res, 200, await setActivePlan(body.planId));
        return;
      }
      if (body.action === "publish") {
        sendJson(res, 200, await publishPlan(body.planId));
        return;
      }
      if (body.action === "toggleTask") {
        sendJson(res, 200, await toggleTask(body.planId, body.taskId, body.homeroom));
        return;
      }
      if (body.action === "editTask") {
        sendJson(res, 200, await editTask(body.planId, body.taskId, body.text));
        return;
      }
      if (body.action === "deleteTask") {
        sendJson(res, 200, await deleteTask(body.planId, body.taskId));
        return;
      }
      if (body.action === "addTask") {
        sendJson(res, 200, await addTask(body.planId, body.dayIndex, body.text));
        return;
      }
      if (body.action === "updateSettings") {
        sendJson(res, 200, await updateSettings(body.settings || {}));
        return;
      }
      if (body.action === "addTodo") {
        sendJson(res, 200, await addTodo(body.todo || {}));
        return;
      }
      if (body.action === "deleteTodo") {
        sendJson(res, 200, await deleteTodo(body.todoId));
        return;
      }
      sendJson(res, 400, { error: "Unknown plan action." });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Firestore request failed." });
  }
};
