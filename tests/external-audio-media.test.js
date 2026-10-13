import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { createPathSecurity } from "../main/pathSecurity.js";
import { sanitizeBatchJobMedia } from "../main/utils/process-media-validation.js";

it("approves audio assets and rejects a removed file or a forged extension before processing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beru-audio-media-"));
  try {
    const video = path.join(root, "clip.mp4"),
      audio = path.join(root, "music.wav"),
      wrong = path.join(root, "wrong.exe");
    for (const p of [video, audio, wrong]) fs.writeFileSync(p, "synthetic fixture");
    const security = createPathSecurity({
      getPath: () => root,
      getAppPath: () => root,
      isPackaged: false,
    });
    expect(security.registerSelectedPath(video, "video").ok).toBe(true);
    expect(security.registerSelectedPath(audio, "audio").ok).toBe(true);
    const job = { input_path: video, operations: [], external_audio: { path: audio, mode: "mix" } };
    const [sanitized] = await sanitizeBatchJobMedia([job], security, {});
    expect(sanitized.external_audio.path).toBe(fs.realpathSync(audio));
    expect(sanitized.asset_roots).toContain(root);
    await expect(
      sanitizeBatchJobMedia([{ ...job, external_audio: { path: wrong } }], security, {}),
    ).rejects.toThrow(/Audio/);
    fs.unlinkSync(audio);
    await expect(sanitizeBatchJobMedia([job], security, {})).rejects.toThrow(/Audio/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
