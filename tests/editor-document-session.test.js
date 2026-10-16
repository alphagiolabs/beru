import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handlers: new Map(), open: vi.fn(), save: vi.fn(), root: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => mocks.root },
  ipcMain: { handle: (channel, handler) => mocks.handlers.set(channel, handler) },
}));
vi.mock("../main/utils/dialog-history.js", () => ({
  showOpenDialog: mocks.open,
  showSaveDialog: mocks.save,
}));
vi.mock("../main/processing-run.js", () => ({ executeProcessingRun: vi.fn(), cancelRun: vi.fn() }));
vi.mock("../main/utils/video-cache.js", () => ({ probeVideo: vi.fn() }));

import { registerEditorHandlers } from "../main/handlers/editor.js";
import {
  readAutosave,
  readEditorDocument,
  writeEditorDocument,
} from "../main/utils/editor-document-io.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { IPC_INVOKE } from "../shared/ipc-channels.js";

const event = {
  senderFrame: { url: pathToFileURL(path.join(process.cwd(), "build/index.html")).href },
};
const invoke = (channel, ...args) => mocks.handlers.get(channel)(event, ...args);

beforeEach(() => {
  mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), "beru-document-session-"));
  mocks.open.mockReset();
  mocks.save.mockReset();
  registerEditorHandlers({
    registerSelectedPath: (filePath) => ({ ok: true, resolvedPath: filePath }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(mocks.root, { recursive: true, force: true });
});

it("keeps document destinations and a newer autosave when an older save finishes late", async () => {
  const fileA = path.join(mocks.root, "a.json"),
    fileB = path.join(mocks.root, "b.json");
  const a = createEmptyEditorProject({ name: "A" }),
    b = createEmptyEditorProject({ name: "B" });
  await writeEditorDocument(fileA, a);
  await writeEditorDocument(fileB, b);
  mocks.open
    .mockResolvedValueOnce({ filePaths: [fileA] })
    .mockResolvedValueOnce({ filePaths: [fileB] });
  await invoke(IPC_INVOKE.openEditorProject);
  let release, reached;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const writing = new Promise((resolve) => {
    reached = resolve;
  });
  const rename = fs.promises.rename;
  vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
    if (to === fileA) {
      reached();
      await blocked;
    }
    return rename(from, to);
  });
  const savingA = invoke(IPC_INVOKE.saveEditorProject, {
    project: { ...a, revision: 1 },
    baseRevision: 0,
    filePath: fileA,
  });
  try {
    await writing;
    await invoke(IPC_INVOKE.openEditorProject);
    const editedB = { ...b, revision: 1, canvas: { ...b.canvas, width: 800 } };
    await invoke(IPC_INVOKE.writeEditorAutosave, { project: editedB });
    release();
    expect(await savingA).toMatchObject({ success: true, filePath: fileA });
    const recovered = await readAutosave(path.join(mocks.root, "editor-autosave.json"));
    expect(recovered.autosave?.project).toEqual(editedB);
    expect(
      await invoke(IPC_INVOKE.saveEditorProject, {
        project: editedB,
        baseRevision: 0,
        filePath: fileB,
      }),
    ).toMatchObject({ success: true, filePath: fileB });
    expect((await readEditorDocument(fileA)).project.name).toBe("A");
    expect((await readEditorDocument(fileB)).project.canvas.width).toBe(800);
    expect((await readAutosave(path.join(mocks.root, "editor-autosave.json"))).autosave).toBeNull();
  } finally {
    release();
    await savingA;
  }
});

it("rejects a renderer-provided destination that was never selected", async () => {
  const destination = path.join(mocks.root, "unapproved.json");
  expect(
    await invoke(IPC_INVOKE.saveEditorProject, {
      project: createEmptyEditorProject(),
      filePath: destination,
    }),
  ).toMatchObject({ success: false });
  expect(fs.existsSync(destination)).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
});
