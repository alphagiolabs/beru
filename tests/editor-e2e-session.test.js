import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  startVite: vi.fn(),
  startPreview: vi.fn(),
  launchElectron: vi.fn(),
  connectMain: vi.fn(),
  connectPage: vi.fn(),
  killTree: vi.fn(async () => {}),
  sleep: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("../scripts/editor-e2e/harness.mjs", () => ({
  RUN_ROOT: process.env.TEMP,
  ...harness,
}));

import { startSession } from "../scripts/editor-e2e/session.mjs";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BERU_E2E_APP", "");
  vi.stubEnv("BERU_E2E_RENDERER", "dev");
});

afterEach(() => vi.unstubAllEnvs());

it("stops Vite when readiness fails before Electron starts", async () => {
  const vite = { pid: 42 };
  const error = new Error("Vite readiness timed out");
  harness.startVite.mockReturnValue(vite);
  harness.waitUntil.mockRejectedValueOnce(error);

  await expect(startSession("session-startup-test")).rejects.toBe(error);

  expect(harness.killTree).toHaveBeenCalledWith(vite);
  expect(harness.launchElectron).not.toHaveBeenCalled();
});
