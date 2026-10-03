export const IDLE_UPDATE = {
  status: "idle",
  version: null,
  percent: 0,
  error: null,
  transferred: 0,
  total: 0,
  releaseNotes: "",
  releaseUrl: null,
  verified: false,
};

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

const PENDING_UPDATE_STATUSES = new Set(["available", "downloading", "ready"]);

export function reduceUpdaterEvent(current, payload) {
  if (!payload || typeof payload !== "object") return current;

  const type = payload.type;

  if (type === "checking") {
    if (PENDING_UPDATE_STATUSES.has(current?.status)) return current;
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
    if (PENDING_UPDATE_STATUSES.has(current?.status)) return current;
    return { ...IDLE_UPDATE, verified: true };
  }

  if (type === "downloading") {
    return {
      status: "downloading",
      version: payload.version || current?.version || null,
      percent: clampPercent(payload.percent),
      error: null,
      transferred: payload.transferred || 0,
      total: payload.total || 0,
      releaseNotes: payload.releaseNotes || current?.releaseNotes || "",
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
      releaseNotes: payload.releaseNotes || current?.releaseNotes || "",
      releaseUrl: payload.releaseUrl || current?.releaseUrl || null,
    };
  }

  if (type === "error") {
    const status = payload.recoverTo || current?.status;
    if (status === "ready") {
      return {
        ...current,
        ...payload,
        status: "ready",
        percent: 100,
        error: payload.message || null,
      };
    }
    if (current?.status === "downloading") {
      return {
        ...current,
        status: "available",
        percent: 0,
        transferred: 0,
        total: 0,
        error: payload.message || null,
      };
    }
    if (status === "available") {
      return { ...current, ...payload, status: "available", error: payload.message || null };
    }
    return { ...IDLE_UPDATE, error: payload.message || null };
  }

  if (type === "disabled") {
    return { ...IDLE_UPDATE, status: "disabled" };
  }

  return current;
}

export function canStartDownload(update) {
  return update?.status === "available" && !!update?.version;
}
