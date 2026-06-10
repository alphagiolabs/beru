export const IDLE_UPDATE = {
  status: "idle",
  version: null,
  percent: 0,
  error: null,
  transferred: 0,
  total: 0,
  releaseNotes: "",
  releaseUrl: null,
};

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

const ACTIVE_STATUSES = new Set(["downloading", "ready"]);

/** Pure reducer for updater IPC events → renderer store shape. */
export function reduceUpdaterEvent(current, payload) {
  if (!payload || typeof payload !== "object") return current;

  const type = payload.type;

  if (type === "checking") {
    if (ACTIVE_STATUSES.has(current?.status)) return current;
    return { ...IDLE_UPDATE, status: "checking" };
  }

  if (type === "available") {
    return {
      status: "available",
      version: payload.version || null,
      percent: 0,
      error: null,
      transferred: 0,
      total: 0,
      releaseNotes: payload.releaseNotes || "",
      releaseUrl: payload.releaseUrl || null,
    };
  }

  if (type === "not-available") {
    if (ACTIVE_STATUSES.has(current?.status)) return current;
    return { ...IDLE_UPDATE };
  }

  if (type === "downloading") {
    return {
      status: "downloading",
      version: payload.version || current?.version || null,
      percent: clampPercent(payload.percent),
      error: null,
      transferred: payload.transferred || 0,
      total: payload.total || 0,
      releaseNotes: current?.releaseNotes || "",
      releaseUrl: payload.releaseUrl || current?.releaseUrl || null,
    };
  }

  if (type === "ready") {
    return {
      status: "ready",
      version: payload.version || current?.version || null,
      percent: 100,
      error: null,
      transferred: current?.total || current?.transferred || 0,
      total: current?.total || 0,
      releaseNotes: current?.releaseNotes || "",
      releaseUrl: payload.releaseUrl || current?.releaseUrl || null,
    };
  }

  if (type === "error") {
    if (current?.status === "ready") return current;
    if (current?.status === "downloading") {
      return {
        ...current,
        status: "available",
        percent: 0,
        transferred: 0,
        total: 0,
        error: null,
      };
    }
    return { ...IDLE_UPDATE };
  }

  if (type === "disabled") {
    return { ...IDLE_UPDATE, status: "disabled" };
  }

  return current;
}

export function canStartDownload(update) {
  return update?.status === "available" && !!update?.version;
}

export function isUpdateFlowActive(update) {
  const status = update?.status || "idle";
  return status === "checking" || status === "downloading";
}
