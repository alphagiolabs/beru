export async function fetchVideoInfos(api, paths) {
  const infos = [];
  for (let offset = 0; offset < paths.length; offset += 500) {
    const chunk = paths.slice(offset, offset + 500);
    let batch;
    if (api?.getVideoInfoBatch) {
      try {
        batch = await api.getVideoInfoBatch(chunk);
      } catch (error) {
        if (!api.getVideoInfo) throw error;
      }
    }
    if (!batch) {
      batch = await Promise.all(
        chunk.map((filePath) =>
          api?.getVideoInfo ? api.getVideoInfo(filePath) : { width: 0, height: 0, duration: 0 },
        ),
      );
    }
    for (let i = 0; i < chunk.length; i++) infos.push(batch[i] ?? null);
  }
  return infos;
}
