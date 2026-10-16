import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import { IPC_INVOKE } from "../shared/ipc-channels.js";

const trustedSenderEvent = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build", "index.html")).href },
};

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  execute: vi.fn(async () => ({ success: true })),
  outputs: vi.fn(async () => []),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
}));
vi.mock("../main/shared-state.js", () => ({
  getMainWindow: () => null,
  isDev: false,
  DEV_URL: "http://localhost:5173",
}));
vi.mock("../main/processing-run.js", () => ({
  executeProcessingRun: mocks.execute,
  cancelRun: async () => ({ success: true, idle: true }),
}));
vi.mock("../main/utils/paths.js", () => ({ validateMediaBinaries: () => ({ ok: true }) }));
vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: async () => ({ ok: true }),
}));
vi.mock("../main/utils/dialog-history.js", () => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));
vi.mock("../main/utils/restore-session-paths.js", () => ({ restoreSessionPaths: vi.fn() }));
vi.mock("../main/utils/process-media-validation.js", () => ({
  sanitizeBatchJobMedia: async (jobs) => jobs,
}));
vi.mock("../main/utils/process-input-validation.js", () => ({
  findUnreadableInputsAsync: async () => [],
}));
vi.mock("../main/utils/process-output.js", () => ({
  validateBatchOutputPaths: async () => {},
  deriveOutputPath: (_directory, file) => file,
  findExistingOutputs: mocks.outputs,
}));

const { registerProcessHandlers } = await import("../main/handlers/process.js");
const { registerCompositionHandlers } = await import("../main/handlers/composition.js");
const { registerStabilizationHandlers } = await import("../main/handlers/stabilization.js");
const video = {
  id: 0,
  input_path: "C:/video.mp4",
  output_path: "C:/out/video.mp4",
  video_duration: 1,
};
const cases = [
  [IPC_INVOKE.startProcessing, video],
  [
    IPC_INVOKE.startComposition,
    {
      id: -1,
      kind: "composition",
      output_path: "C:/out/composition.mp4",
      canvas: { width: 1920, height: 1080, fit: "contain" },
      composition_fps: 30,
      clips: [video, { ...video, id: 1 }],
    },
  ],
  [
    IPC_INVOKE.startStabilization,
    {
      ...video,
      id: -2,
      kind: "stabilization",
      stabilization: { intensity: "medium", edges: "zoom" },
    },
  ],
];

beforeEach(() => {
  mocks.execute.mockClear();
  mocks.outputs.mockReset().mockResolvedValue([]);
  const security = { getOutputDirectory: () => "C:/out", registerAllowedPath: vi.fn() };
  registerProcessHandlers(security);
  registerCompositionHandlers(security);
  registerStabilizationHandlers(security);
});

describe("export preparation cancellation", () => {
  it.each(cases)("does not launch %s after cancelling its output check", async (channel, job) => {
    let release;
    mocks.outputs.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = mocks.handlers.get(channel)(trustedSenderEvent, [job]);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await mocks.handlers.get(IPC_INVOKE.cancelProcessing)(trustedSenderEvent);
    release([]);
    expect(await pending).toMatchObject({ success: false, cancelled: true });
    expect(mocks.execute).not.toHaveBeenCalled();

    mocks.outputs.mockResolvedValue([]);
    expect(await mocks.handlers.get(channel)(trustedSenderEvent, [job])).toMatchObject({
      success: true,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
