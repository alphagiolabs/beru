import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import vm from "vm";
import { pathToFileURL } from "url";

const mocks = vi.hoisted(() => ({ handlers: new Map() }));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
  app: { isPackaged: false },
}));

const { handleIpc, isTrustedDocumentUrl } = await import("../main/utils/ipc.js");
const { DEV_URL } = await import("../main/shared-state.js");

const appIndexUrl = pathToFileURL(path.join(process.cwd(), "build", "index.html")).href;
const appOverlayUrl = pathToFileURL(path.join(process.cwd(), "build", "pet-overlay.html")).href;

function beruRequest({ origin = null, referer = null } = {}) {
  const headers = { origin, referer };
  return {
    url: "beru://local/%2Ftmp%2Fclip.mp4",
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  };
}

async function startBeruHandler() {
  const source = fs
    .readFileSync(path.join(process.cwd(), "main", "main.js"), "utf8")
    .replace(/^import\b[\s\S]*?;\r?\n/gm, "");
  const protocolHandlers = new Map();
  const validateBeruRequestPath = vi.fn(() => ({ ok: true, resolvedPath: "C:\\media\\clip.mp4" }));
  const createBeruVideoResponse = vi.fn(() => new Response("video", { status: 200 }));
  const context = {
    requireWindows: () => {},
    app: {
      getPath: () => "/tmp",
      getAppPath: () => "/beru",
      on: vi.fn(),
      whenReady: () => Promise.resolve(),
      commandLine: { appendSwitch: vi.fn() },
      setName: vi.fn(),
      setAppUserModelId: vi.fn(),
      quit: vi.fn(),
    },
    BrowserWindow: {},
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
      handle: (scheme, handler) => protocolHandlers.set(scheme, handler),
    },
    fs: { readdirSync: () => [], statSync: () => ({ size: 0 }), appendFileSync: vi.fn() },
    path,
    fileURLToPath: vi.fn(),
    console: { error: vi.fn() },
    process: { platform: "win32", on: vi.fn() },
    Buffer,
    Date,
    Response,
    createPathSecurity: () => ({}),
    setAppIsQuitting: vi.fn(),
    getPythonProcess: () => null,
    hasActiveProcessing: () => false,
    cancelRun: vi.fn(async () => ({})),
    sweepOrphanedArtifacts: vi.fn(),
    createBeruVideoResponse,
    hasKnownBeruType: vi.fn(() => true),
    validateBeruRequestPath,
    killProcessTree: vi.fn(),
    createWindow: vi.fn(),
    disposePreviewFrameWorker: vi.fn(),
    disposeJobWorker: vi.fn(),
    disposePetsModule: vi.fn(),
    isQuittingForUpdate: () => false,
    isTrustedDocumentUrl,
  };
  for (const name of [
    "registerDialogHandlers",
    "registerVideoHandlers",
    "registerDropHandlers",
    "registerFileHandlers",
    "registerAudioHandlers",
    "registerProcessHandlers",
    "registerCompositionHandlers",
    "registerStabilizationHandlers",
    "registerProjectHandlers",
    "registerPresetHandlers",
    "registerSettingsHandlers",
    "registerRecentHandlers",
    "registerSystemHandlers",
    "registerUpdaterHandlers",
    "registerPetsModule",
  ])
    context[name] = vi.fn();
  vm.runInNewContext(source, context, { filename: "main/main.js" });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    handler: protocolHandlers.get("beru"),
    validateBeruRequestPath,
    createBeruVideoResponse,
  };
}

describe("ipc sender validation", () => {
  it("handleIpc runs fn when senderFrame.url is the app document", async () => {
    mocks.handlers.clear();
    const fn = vi.fn(async () => ({ success: true }));
    handleIpc("test:trusted", fn);
    const handler = mocks.handlers.get("test:trusted");
    for (const url of [appIndexUrl, appOverlayUrl, DEV_URL]) {
      await expect(handler({ senderFrame: { url } })).resolves.toEqual({ success: true });
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("handleIpc rejects without running fn when the frame is an external URL", async () => {
    mocks.handlers.clear();
    const fn = vi.fn(async () => ({ success: true }));
    handleIpc("test:untrusted", fn);
    const handler = mocks.handlers.get("test:untrusted");
    await expect(
      handler({ senderFrame: { url: "https://evil.example.com/page.html" } }),
    ).resolves.toEqual({
      success: false,
      error: "untrusted sender",
    });
    await expect(handler({})).resolves.toEqual({ success: false, error: "untrusted sender" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("beru: handler answers 403 for an external Origin and serves trusted or absent Origin", async () => {
    const { handler, validateBeruRequestPath, createBeruVideoResponse } = await startBeruHandler();
    expect(handler).toBeTypeOf("function");

    const external = await handler(beruRequest({ origin: "https://evil.example.com" }));
    expect(external.status).toBe(403);
    await expect(external.text()).resolves.toBe("Origen no permitido");
    expect(validateBeruRequestPath).not.toHaveBeenCalled();

    const externalReferer = await handler(
      beruRequest({ referer: "https://evil.example.com/x.html" }),
    );
    expect(externalReferer.status).toBe(403);

    const own = await handler(beruRequest({ origin: appIndexUrl }));
    expect(own.status).toBe(200);
    expect(createBeruVideoResponse).toHaveBeenCalledTimes(1);

    const absent = await handler(beruRequest());
    expect(absent.status).toBe(200);
  });
});
