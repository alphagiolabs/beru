import os from "os";

const maxActive = Math.max(2, Math.min(8, os.cpus()?.length || 4));
const highPriority = [];
const normalPriority = [];
let active = 0;
let processingActive = false;

function dispatch() {
  const capacity = processingActive ? Math.min(2, maxActive) : maxActive;
  while (active < capacity) {
    const entry = highPriority.shift() || normalPriority.shift();
    if (!entry) return;
    active += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        dispatch();
      });
  }
}

export function runMediaTask(task, { interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    const queue = interactive ? highPriority : normalPriority;
    queue.push({ task, resolve, reject });
    dispatch();
  });
}

export function setMediaProcessingActive(value) {
  processingActive = Boolean(value);
  dispatch();
}
