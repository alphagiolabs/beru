import os from "os";

const RESERVED_MEMORY_MB = 512;
const MEMORY_PER_TASK_MB = 192;

export function createMediaTaskPool({
  maxActive = Math.max(2, Math.min(8, os.cpus()?.length || 4)),
  processingCapacity = 2,
  maxQueuedTasks = 2000,
  freeMemoryMb = () => os.freemem() / (1024 * 1024),
} = {}) {
  const highPriority = [];
  const visiblePriority = [];
  const metadataPriority = [];
  const normalPriority = [];
  const queues = [normalPriority, metadataPriority, visiblePriority, highPriority];
  const keyedTasks = new Map();
  let active = 0;
  let reservedMemoryMb = 0;
  let initialFreeMemoryMb = 0;
  let processingActive = false;
  const drainWaiters = new Set();

  function memoryBudgetMb() {
    try {
      const availableMb = freeMemoryMb();
      if (Number.isFinite(availableMb)) {
        if (active === 0 || availableMb > initialFreeMemoryMb) initialFreeMemoryMb = availableMb;
        const memoryMb = Math.min(initialFreeMemoryMb, availableMb + reservedMemoryMb);
        return Math.max(0, (memoryMb - RESERVED_MEMORY_MB) * 0.8);
      }
    } catch {}
    return 0;
  }

  function needsToDrain() {
    return (
      processingActive &&
      (active > processingCapacity || (active > 1 && reservedMemoryMb > memoryBudgetMb()))
    );
  }

  function notifyDrainWaiters() {
    if (needsToDrain()) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }

  function dispatch() {
    const limit = processingActive ? Math.min(processingCapacity, maxActive) : maxActive;
    while (active < limit) {
      const budget = memoryBudgetMb();
      let entry;
      for (let priority = queues.length - 1; priority >= 0; priority--) {
        const queue = queues[priority];
        const index = queue.findIndex(
          (task) => active === 0 || reservedMemoryMb + task.memoryMb <= budget,
        );
        if (index >= 0) {
          [entry] = queue.splice(index, 1);
          break;
        }
      }
      if (!entry) return;
      entry.queued = false;
      entry.detachAbort?.();
      active += 1;
      reservedMemoryMb += entry.memoryMb;
      Promise.resolve()
        .then(entry.task)
        .then(
          (result) => {
            if (entry.key) keyedTasks.delete(entry.key);
            entry.resolve(result);
          },
          (error) => {
            if (entry.key) keyedTasks.delete(entry.key);
            entry.reject(error);
          },
        )
        .finally(() => {
          active -= 1;
          reservedMemoryMb -= entry.memoryMb;
          notifyDrainWaiters();
          dispatch();
        });
    }
  }

  function run(
    task,
    {
      interactive = false,
      visible = false,
      metadata = false,
      key,
      signal,
      memoryMb = MEMORY_PER_TASK_MB,
    } = {},
  ) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const priority = interactive ? 3 : visible ? 2 : metadata ? 1 : 0;
    const queue = queues[priority];
    const pending = key && keyedTasks.get(key);
    if (pending) {
      if (
        pending.queued &&
        (priority > pending.priority ||
          (visible && !interactive && priority === pending.priority)) &&
        queue.length < maxQueuedTasks
      ) {
        const previous = queues[pending.priority];
        previous.splice(previous.indexOf(pending), 1);
        pending.priority = priority;
        if (visible && !interactive) queue.unshift(pending);
        else queue.push(pending);
      }
      dispatch();
      return pending.promise;
    }
    let entry;
    const promise = new Promise((resolve, reject) => {
      if (queue.length >= maxQueuedTasks) {
        reject(new Error("Demasiadas tareas de medios en cola"));
        return;
      }
      entry = {
        task,
        resolve,
        reject,
        priority,
        queued: true,
        key,
        memoryMb: Number.isFinite(memoryMb) && memoryMb > 0 ? memoryMb : MEMORY_PER_TASK_MB,
      };
      if (visible && !interactive) queue.unshift(entry);
      else queue.push(entry);
    });
    if (!entry) return promise;
    entry.promise = promise;
    if (key) keyedTasks.set(key, entry);
    if (signal) {
      const cancel = () => {
        const pendingQueue = queues[entry.priority];
        pendingQueue.splice(pendingQueue.indexOf(entry), 1);
        if (key) keyedTasks.delete(key);
        entry.detachAbort();
        entry.reject(signal.reason);
        dispatch();
      };
      entry.detachAbort = () => signal.removeEventListener("abort", cancel);
      signal.addEventListener("abort", cancel, { once: true });
    }
    dispatch();
    return promise;
  }

  function setProcessingActive(value) {
    processingActive = Boolean(value);
    notifyDrainWaiters();
    dispatch();
  }

  function waitForDrain() {
    if (!needsToDrain()) return Promise.resolve();
    return new Promise((resolve) => drainWaiters.add(resolve));
  }

  return { run, setProcessingActive, waitForDrain };
}

const sharedPool = createMediaTaskPool();

export const runMediaTask = sharedPool.run;
export const setMediaProcessingActive = sharedPool.setProcessingActive;
export const waitForMediaTasksToDrain = sharedPool.waitForDrain;
