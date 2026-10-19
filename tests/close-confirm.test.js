import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCloseConfirm, resolveCloseConfirm } from "../main/utils/closeConfirm.js";

function fakeContents() {
  return { send: vi.fn() };
}

afterEach(() => vi.useRealTimers());

describe("close confirm handshake", () => {
  it("waits for the renderer answer after an ack", async () => {
    vi.useFakeTimers();
    const contents = fakeContents();
    const answer = requestCloseConfirm(contents, "window:confirmClose", { processing: false });
    const [channel, { id, processing }] = contents.send.mock.calls[0];
    expect(channel).toBe("window:confirmClose");
    expect(processing).toBe(false);

    let settled = false;
    answer.then(() => {
      settled = true;
    });
    expect(resolveCloseConfirm(id, { ack: true })).toBe(true);
    await Promise.resolve();
    vi.advanceTimersByTime(60_000);
    expect(settled).toBe(false);
    expect(resolveCloseConfirm(id, { confirmed: false })).toBe(true);
    await expect(answer).resolves.toBe(false);
    expect(settled).toBe(true);
  });

  it("resolves null when the renderer never acknowledges", async () => {
    vi.useFakeTimers();
    const contents = fakeContents();
    const answer = requestCloseConfirm(contents, "window:confirmClose", { processing: true });
    const { id } = contents.send.mock.calls[0][1];
    vi.advanceTimersByTime(2000);
    await expect(answer).resolves.toBeNull();
    expect(resolveCloseConfirm(id, { confirmed: true })).toBe(false);
  });
});
