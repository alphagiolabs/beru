import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createPathSecurity } from "../main/pathSecurity.js";

const fakeApp = {
  getPath: (name) => {
    const map = {
      userData: path.join(os.tmpdir(), "beru-test-userdata"),
      temp: os.tmpdir(),
      home: os.homedir(),
      documents: path.join(os.homedir(), "Documents"),
      downloads: path.join(os.homedir(), "Downloads"),
      desktop: path.join(os.homedir(), "Desktop"),
      videos: path.join(os.homedir(), "Videos"),
      music: path.join(os.homedir(), "Music"),
      pictures: path.join(os.homedir(), "Pictures"),
    };
    return map[name] || os.tmpdir();
  },
  isPackaged: false,
  getAppPath: () => process.cwd(),
};

describe("pathSecurity", () => {
  let security;
  let tmpFile;

  beforeEach(() => {
    security = createPathSecurity(fakeApp);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-sec-"));
    tmpFile = path.join(dir, "sheet.xlsx");
    fs.writeFileSync(tmpFile, Buffer.from("PK"));
    security.registerAllowedPath(tmpFile);
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("allows explicitly registered excel paths", () => {
    const res = security.validateReadableFile(tmpFile, "excel");
    expect(res.ok).toBe(true);
  });

  it("denies sensitive system paths even with excel extension", () => {
    const res = security.validateReadableFile(
      process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/passwd",
      "excel",
    );
    expect(res.ok).toBe(false);
  });

  it("rejects non-excel extensions for excel kind", () => {
    security.registerAllowedPath(__filename);
    const res = security.validateReadableFile(__filename, "excel");
    expect(res.ok).toBe(false);
  });

  it("limits beru protocol reads to validated video files", () => {
    const res = security.validateProtocolFile(tmpFile);
    expect(res.ok).toBe(false);
  });

  it("rejects missing shell paths", () => {
    const res = security.validateShellPath(path.join(path.dirname(tmpFile), "missing.mp4"));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Archivo no encontrado");
  });
});
