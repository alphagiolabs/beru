import { describe, it, expect, vi } from "vitest";
import os from "os";
import path from "path";
import { createPathResolver } from "../main/security/path-resolver.js";
import { createLocationPolicy } from "../main/security/location-policy.js";
import { createConsentStore } from "../main/security/consent.js";
import { createWriteCapabilities } from "../main/security/write-capability.js";
import { createPathVerdicts } from "../main/security/path-verdicts.js";

const identity = (p) => p;
const lowercase = (p) => p.toLowerCase();

describe("path-resolver", () => {
  it("rejects empty and null-byte paths without touching fs", () => {
    const realpath = vi.fn();
    const { resolveSafe } = createPathResolver({ realpath });
    expect(resolveSafe("")).toBeNull();
    expect(resolveSafe("  ")).toBeNull();
    expect(resolveSafe("a\0b")).toBeNull();
    expect(resolveSafe(42)).toBeNull();
    expect(realpath).not.toHaveBeenCalled();
  });

  it("memoizes realpath and honors BERU_RESOLVE_CACHE=0", () => {
    const realpath = vi.fn((p) => `real:${p}`);
    const cached = createPathResolver({ realpath, env: {} });
    expect(cached.resolveSafe("x")).toBe("real:x");
    expect(cached.resolveSafe("x")).toBe("real:x");
    expect(realpath).toHaveBeenCalledTimes(1);

    const uncached = createPathResolver({ realpath, env: { BERU_RESOLVE_CACHE: "0" } });
    uncached.resolveSafe("y");
    uncached.resolveSafe("y");
    expect(realpath).toHaveBeenCalledTimes(3);
  });

  it("resolves the longest existing ancestor when the leaf is missing", () => {
    const root = path.parse(process.cwd()).root;
    const missing = path.join(root, "no-such-dir", "deep", "leaf.txt");
    const realpath = vi.fn((p) => {
      if (
        p === missing ||
        p === path.dirname(missing) ||
        p === path.dirname(path.dirname(missing))
      ) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return p;
    });
    const { resolveSafe } = createPathResolver({ realpath, env: { BERU_RESOLVE_CACHE: "0" } });
    expect(resolveSafe(missing)).toBe(missing);
  });

  it("normalizes Windows path keys without case distinctions", () => {
    const mixed = path.join("Some", "MixedCase", "Path");
    const resolver = createPathResolver({ realpath: identity });
    expect(resolver.normalizeKey(mixed)).toBe(path.normalize(mixed).toLowerCase());
  });
});

describe("location policy", () => {
  const root = path.join(os.tmpdir(), "beru-roots");
  const makeApp = (overrides = {}) => ({
    getPath: (name) => path.join(root, name),
    isPackaged: false,
    getAppPath: () => path.join(root, "app"),
    ...overrides,
  });
  const makeRoots = (app, extra = {}) =>
    createLocationPolicy({ app, resolveSafe: identity, normalizeKey: lowercase, ...extra });

  it("treats the root and its children as trusted but not sibling prefixes", () => {
    const { isUnderRoot } = makeRoots(makeApp());
    const trusted = path.join(root, "temp");
    expect(isUnderRoot(trusted)).toBe(true);
    expect(isUnderRoot(path.join(trusted, "clip.mp4"))).toBe(true);
    expect(isUnderRoot(`${trusted}-evil`)).toBe(false);
    expect(isUnderRoot(path.join(root, "nowhere", "clip.mp4"))).toBe(false);
  });

  it("denies system paths regardless of roots", () => {
    const { isDenied } = makeRoots(makeApp());
    const denied = "C:\\Windows\\System32\\drivers\\etc\\hosts";
    expect(isDenied(denied)).toBe(true);
    expect(isDenied(path.join(root, "temp", "clip.mp4"))).toBe(false);
  });

  it("refreshes roots after the TTL and skips failing app paths", () => {
    let time = 0;
    const app = makeApp({
      getPath: vi.fn((name) => {
        if (name === "userData") throw new Error("not ready");
        return path.join(root, name);
      }),
    });
    const warn = vi.fn();
    const { isUnderRoot } = makeRoots(app, { now: () => time, warn });

    const userDataFile = path.join(root, "userData", "f.mp4");
    expect(isUnderRoot(userDataFile)).toBe(false);
    expect(warn).toHaveBeenCalled();

    app.getPath.mockImplementation((name) => path.join(root, name));
    time += 31_000;
    expect(isUnderRoot(userDataFile)).toBe(true);
  });

  it("uses resourcesPath instead of the app path when packaged", () => {
    const installed = path.join(root, "installed");
    const { isUnderRoot } = createLocationPolicy({
      app: makeApp({ isPackaged: true }),
      resolveSafe: identity,
      normalizeKey: lowercase,
      resourcesPath: installed,
    });
    expect(isUnderRoot(path.join(installed, "bin", "x"))).toBe(true);
    expect(isUnderRoot(path.join(root, "app", "x"))).toBe(false);
  });
});

describe("consent store", () => {
  const make = () => createConsentStore({ normalizeKey: identity });

  it("grants reads only to registered paths", () => {
    const consent = make();
    const file = path.join("dir", "a.mp4");
    expect(consent.hasReadConsent(file)).toBe(false);
    consent.grantRead(file);
    expect(consent.hasReadConsent(file)).toBe(true);
  });

  it("consents to children of the selected output dir, not siblings", () => {
    const consent = make();
    const dir = path.join("out", "rendered");
    consent.selectOutputDirectory(dir);
    expect(consent.getOutputDirectory()).toBe(dir);
    expect(consent.hasReadConsent(dir)).toBe(true);
    expect(consent.hasReadConsent(path.join(dir, "job.mp4"))).toBe(true);
    expect(consent.hasReadConsent(`${dir}-other${path.sep}job.mp4`)).toBe(false);
  });

  it("starts with no output directory", () => {
    expect(make().getOutputDirectory()).toBeNull();
  });

  it("keeps read grants for the lifetime of a selection", () => {
    const consent = make();
    for (let i = 0; i < 2001; i++) consent.grantRead(`f${i}`);
    expect(consent.hasReadConsent("f0")).toBe(true);
    expect(consent.hasReadConsent("f2000")).toBe(true);
  });
});

describe("write capabilities", () => {
  const make = ({ resolveSafe = identity, isDenied = () => false } = {}) =>
    createWriteCapabilities({ resolveSafe, location: { isDenied }, normalizeKey: identity });

  it("is one-shot: consume replays nothing", () => {
    const writes = make();
    const target = path.join("dir", "out.mp4");
    expect(writes.approve(target)).toEqual({ ok: true });
    expect(writes.consume(target)).toBe(target);
    expect(writes.consume(target)).toBeNull();
  });

  it("refuses denied or unresolvable targets", () => {
    const writes = make({ isDenied: () => true });
    expect(writes.approve("evil")).toEqual({ ok: false });
    expect(writes.consume("evil")).toBeNull();

    const broken = make({ resolveSafe: () => null });
    expect(broken.approve("x")).toEqual({ ok: false });
    expect(broken.consume("x")).toBeNull();
  });
});

describe("path verdicts", () => {
  const statFile = (size = 10) => ({ isFile: () => true, isDirectory: () => false, size });
  const statDir = () => ({ isFile: () => false, isDirectory: () => true, size: 0 });

  const makeVerdicts = ({
    resolveSafe = identity,
    isDenied = () => false,
    isUnderRoot = () => true,
    hasReadConsent = () => false,
    statSync = () => statFile(),
    warn = vi.fn(),
  } = {}) =>
    createPathVerdicts({
      resolveSafe,
      location: { isDenied, isUnderRoot },
      consent: { hasReadConsent },
      statSync,
      warn,
    });

  it("fails fast on unresolvable and denied paths", () => {
    const warn = vi.fn();
    const verdicts = makeVerdicts({ resolveSafe: () => null, warn });
    expect(verdicts.inspectReadableFile("x", "video")).toEqual({
      ok: false,
      error: "Ruta inválida",
    });

    const denied = makeVerdicts({ isDenied: () => true, warn });
    expect(denied.inspectReadableFile("x", "video").error).toBe("Ruta no permitida");
    expect(warn).toHaveBeenCalled();
  });

  it("reports missing and non-file paths before checking extensions", () => {
    const missing = makeVerdicts({
      statSync: () => {
        throw new Error("ENOENT");
      },
    });
    expect(missing.inspectReadableFile("x.mp4", "video").error).toBe("Archivo no encontrado");

    const dirOnly = makeVerdicts({ statSync: () => statDir() });
    expect(dirOnly.inspectReadableFile("x.mp4", "video").error).toBe("La ruta no es un archivo");
  });

  it("enforces the per-kind extension allow-list", () => {
    const verdicts = makeVerdicts();
    expect(verdicts.inspectReadableFile("x.txt", "excel").error).toBe(
      "Extensión no permitida: .txt",
    );
    expect(verdicts.inspectReadableFile("x.xlsx", "excel").ok).toBe(true);
  });

  it("requires consent or a trusted root, consent first", () => {
    const isUnderRoot = vi.fn(() => false);
    const consented = makeVerdicts({ isUnderRoot, hasReadConsent: () => true });
    expect(consented.inspectReadableFile("x.mp4", "video").ok).toBe(true);
    expect(isUnderRoot).not.toHaveBeenCalled();

    const verdicts = makeVerdicts({ isUnderRoot: () => false });
    expect(verdicts.inspectReadableFile("x.mp4", "video").error).toBe(
      "Archivo fuera de ubicaciones permitidas",
    );
  });

  it("rejects files over the per-kind size cap", () => {
    const verdicts = makeVerdicts({ statSync: () => statFile(30 * 1024 * 1024) });
    expect(verdicts.inspectReadableFile("x.xlsx", "excel").error).toBe("Archivo demasiado grande");
  });

  it("shell paths allow directories but still require a known location", () => {
    const verdicts = makeVerdicts({ statSync: () => statDir() });
    expect(verdicts.inspectShellPath("some-dir").ok).toBe(true);

    const outside = makeVerdicts({ isUnderRoot: () => false, statSync: () => statDir() });
    expect(outside.inspectShellPath("some-dir").error).toBe("Ruta fuera de ubicaciones permitidas");
  });

  it("output directories must be real, allowed directories", () => {
    const denied = makeVerdicts({ isDenied: () => true });
    expect(denied.inspectOutputDirectory("d").error).toBe("Carpeta de salida no permitida");

    const file = makeVerdicts({ statSync: () => statFile() });
    expect(file.inspectOutputDirectory("d").error).toBe("La salida debe ser una carpeta");

    const missing = makeVerdicts({
      statSync: () => {
        throw new Error("ENOENT");
      },
    });
    expect(missing.inspectOutputDirectory("d").error).toBe("Carpeta de salida no encontrada");

    const ok = makeVerdicts({ statSync: () => statDir() });
    expect(ok.inspectOutputDirectory("d")).toEqual({ ok: true, resolvedPath: "d" });
  });

  it("protocol files keep the image/video split", () => {
    const verdicts = makeVerdicts();
    expect(verdicts.inspectProtocolFile("clip.png").ok).toBe(true);
    expect(verdicts.inspectProtocolFile("clip.xlsx").error).toBe("Extensión no permitida: .xlsx");
  });
});
