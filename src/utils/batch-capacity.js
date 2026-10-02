export function queueCapacityInput(queue = [], templateRegions = []) {
  let maxSourcePixels = 0;
  let hasOps = false;
  const jobs = [];
  for (const item of queue) {
    const w = Number(item.sourceWidth || item.width || 0);
    const h = Number(item.sourceHeight || item.height || 0);
    if (w > 0 && h > 0) maxSourcePixels = Math.max(maxSourcePixels, w * h);
    if ((item.operations || []).length > 0) hasOps = true;
    jobs.push({
      videoCodec: item.videoCodec || "",
      pixFmt: item.pixFmt || "",
      sourceWidth: w,
      sourceHeight: h,
    });
  }
  return {
    queueLength: queue.length,
    maxSourcePixels,
    hasVideoFilters: templateRegions.length > 0 || hasOps,
    jobs,
  };
}

export function capacityJobsSignature(queue = [], templateRegions = []) {
  const jobsSig = queue
    .map((item) =>
      [
        item.videoCodec || "",
        item.pixFmt || "",
        item.sourceWidth || item.width || 0,
        item.sourceHeight || item.height || 0,
      ].join("|"),
    )
    .join(";");
  const hasOps = queue.some((item) => (item.operations || []).length > 0);
  return `${queue.length}:${templateRegions.length}:${hasOps ? 1 : 0}:${jobsSig}`;
}
