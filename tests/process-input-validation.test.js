import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  findUnreadableInputsAsync,
  translateProcessorErrorMessage,
} from "../main/utils/process-input-validation.js";

describe("process:start input path validation (regression: ENOENT for cloud placeholders)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-proc-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("reports unreadable inputs in job order while skipping readable files and absent paths", async () => {
    const good = path.join(tmpDir, "good.mp4");
    const empty = path.join(tmpDir, "empty.mp4");
    fs.writeFileSync(good, Buffer.from("ok"));
    fs.writeFileSync(empty, Buffer.alloc(0));
    const firstBad = path.join(tmpDir, "ghost-a.mp4");
    const secondBad = path.join(tmpDir, "ghost-b.mp4");
    const issues = await findUnreadableInputsAsync([
      { input_path: firstBad },
      { input_path: good },
      { input_path: empty },
      { input_path: "   " },
      { input_path: "" },
      { input_path: null },
      { input_path: undefined },
      {},
      { input_path: secondBad },
    ]);
    expect(issues).toEqual([
      { inputPath: firstBad, ok: false, code: "missing", message: "Archivo no encontrado" },
      {
        inputPath: empty,
        ok: false,
        code: "empty",
        message: "El archivo está vacío (0 bytes)",
      },
      { inputPath: "   ", ok: false, code: "missing", message: "Ruta de video vacía" },
      { inputPath: secondBad, ok: false, code: "missing", message: "Archivo no encontrado" },
    ]);
  });

  it("translates generic ENOENT into a missing-file message (not cloud)", () => {
    const msg = translateProcessorErrorMessage(
      "Process exited with code 1: ffmpeg error: ENOENT: no such file or directory",
    );
    expect(msg).toMatch(/No se encontró un archivo/i);
    expect(msg).not.toMatch(/OneDrive|Google Drive|Dropbox/);
  });

  it("translates cloud-path ENOENT into OneDrive guidance", () => {
    const msg = translateProcessorErrorMessage(
      "ffmpeg: error: No such file or directory: 'C:\\Users\\me\\OneDrive\\Videos\\video.mp4'",
    );
    expect(msg).toMatch(/no está disponible localmente/);
    expect(msg).toMatch(/OneDrive|Google Drive|Dropbox/);
  });

  it("passes unrelated errors through unchanged", () => {
    const msg = "Process exited with code 1: Invalid argument";
    expect(translateProcessorErrorMessage(msg)).toBe(msg);
  });

  it("translates spawn py ENOENT into a Python install message", () => {
    const msg = translateProcessorErrorMessage("spawn py ENOENT");
    expect(msg).toMatch(/Python 3 no está instalado/i);
  });

  it("translates font/drawtext ENOENT into a font message, not the cloud message", () => {
    const cases = [
      "ffmpeg error: Cannot find fontfile 'C:\\Windows\\Fonts\\Missing.ttf': ENOENT",
      "drawtext: No such file or directory for fontfile",
      "[Parsed_drawtext] font not found: ENOENT",
    ];
    for (const raw of cases) {
      const msg = translateProcessorErrorMessage(raw);
      expect(msg, `for ${raw}`).toMatch(/fuente tipográfica/i);
      expect(msg, `for ${raw}`).not.toMatch(/OneDrive|Google Drive|Dropbox/);
    }
  });
});
