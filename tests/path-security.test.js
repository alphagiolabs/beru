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

function makeNarrowApp(trustedRoot) {
  return {
    getPath: (name) => {
      const map = {
        userData: path.join(trustedRoot, "userdata"),
        temp: path.join(trustedRoot, "temp"),
        home: path.join(trustedRoot, "home"),
        documents: path.join(trustedRoot, "home", "Documents"),
        downloads: path.join(trustedRoot, "home", "Downloads"),
        desktop: path.join(trustedRoot, "home", "Desktop"),
        videos: path.join(trustedRoot, "home", "Videos"),
        music: path.join(trustedRoot, "home", "Music"),
        pictures: path.join(trustedRoot, "home", "Pictures"),
      };
      return map[name] || trustedRoot;
    },
    isPackaged: false,
    getAppPath: () => path.join(trustedRoot, "app"),
  };
}

describe("pathSecurity", () => {
  let security;
  let tmpFile;

  beforeEach(() => {
    security = createPathSecurity(fakeApp);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-sec-"));
    tmpFile = path.join(dir, "sheet.xlsx");
    fs.writeFileSync(tmpFile, Buffer.from("PK"));
    security.registerAllowedPath(tmpFile, "excel");
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
    security.registerAllowedPath(__filename, "excel");
    const res = security.validateReadableFile(__filename, "excel");
    expect(res.ok).toBe(false);
  });

  it("limits beru protocol reads to validated video files", () => {
    const res = security.validateProtocolFile(tmpFile);
    expect(res.ok).toBe(false);
  });

  it("allows registered image files through the beru protocol", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-sec-img-"));
    const imgFile = path.join(dir, "patch.png");
    fs.writeFileSync(imgFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    security.registerAllowedPath(imgFile, "image");
    try {
      const res = security.validateProtocolFile(imgFile);
      expect(res.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing shell paths", () => {
    const res = security.validateShellPath(path.join(path.dirname(tmpFile), "missing.mp4"));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Archivo no encontrado");
  });

  it("reports missing files before extension validation", () => {
    const missing = path.join(path.dirname(tmpFile), "ghost.txt");
    security.registerAllowedPath(missing, "excel");
    const res = security.validateReadableFile(missing, "excel");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Archivo no encontrado");
  });

  it("remembers only an output directory explicitly selected by the main process", () => {
    const outputDirectory = path.dirname(tmpFile);

    expect(security.getOutputDirectory()).toBeNull();
    expect(security.registerOutputDirectory(outputDirectory)).toEqual({
      ok: true,
      resolvedPath: fs.realpathSync(outputDirectory),
    });
    expect(security.getOutputDirectory()).toBe(fs.realpathSync(outputDirectory));
    expect(security.registerOutputDirectory(tmpFile).ok).toBe(false);
  });

  it("cannot allow-list denied paths via register then validateReadableFile", () => {
    const denied =
      process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/passwd";
    const reg = security.registerAllowedPath(denied, "excel");
    expect(reg.ok).toBe(false);
    expect(security.validateReadableFile(denied, "excel").ok).toBe(false);
  });

  it("cannot allow-list outside-root paths via register then validateReadableFile", () => {
    const trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-trusted-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-outside-"));
    fs.mkdirSync(path.join(trustedRoot, "temp"), { recursive: true });
    fs.mkdirSync(path.join(trustedRoot, "app"), { recursive: true });
    const outsideFile = path.join(outsideRoot, "clip.mp4");
    fs.writeFileSync(outsideFile, Buffer.from("fake"));

    const narrow = createPathSecurity(makeNarrowApp(trustedRoot));
    try {
      const reg = narrow.registerAllowedPath(outsideFile, "video");
      expect(reg.ok).toBe(false);
      expect(reg.error).toBe("Archivo fuera de ubicaciones permitidas");
      expect(narrow.validateReadableFile(outsideFile, "video").ok).toBe(false);
    } finally {
      fs.rmSync(trustedRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("registers and reads trusted-root files", () => {
    const trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-trusted-"));
    const tempDir = path.join(trustedRoot, "temp");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(path.join(trustedRoot, "app"), { recursive: true });
    const videoFile = path.join(tempDir, "clip.mp4");
    fs.writeFileSync(videoFile, Buffer.from("fake"));

    const narrow = createPathSecurity(makeNarrowApp(trustedRoot));
    try {
      const reg = narrow.registerAllowedPath(videoFile, "video");
      expect(reg.ok).toBe(true);
      expect(narrow.validateReadableFile(videoFile, "video").ok).toBe(true);
    } finally {
      fs.rmSync(trustedRoot, { recursive: true, force: true });
    }
  });

  it("session restore style skips outside-root video paths", () => {
    const trustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-trusted-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-outside-"));
    const tempDir = path.join(trustedRoot, "temp");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(path.join(trustedRoot, "app"), { recursive: true });
    const insideFile = path.join(tempDir, "ok.mp4");
    const outsideFile = path.join(outsideRoot, "bad.mp4");
    fs.writeFileSync(insideFile, Buffer.from("ok"));
    fs.writeFileSync(outsideFile, Buffer.from("bad"));

    const narrow = createPathSecurity(makeNarrowApp(trustedRoot));
    const result = { ok: true, videos: 0, excel: false, errors: [] };
    try {
      for (const videoPath of [insideFile, outsideFile]) {
        const check = narrow.registerAllowedPath(videoPath, "video");
        if (check.ok) result.videos += 1;
        else result.errors.push(check.error || videoPath);
      }
      expect(result.videos).toBe(1);
      expect(result.errors).toEqual(["Archivo fuera de ubicaciones permitidas"]);
      expect(narrow.validateReadableFile(outsideFile, "video").ok).toBe(false);
    } finally {
      fs.rmSync(trustedRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
