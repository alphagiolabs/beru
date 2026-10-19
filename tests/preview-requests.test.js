import { describe, expect, it } from "vitest";
import { createPreviewRequests } from "../src/utils/preview-requests.js";

describe("preview request ownership", () => {
  it("lets a newer request apply while the preceding render is still in flight", () => {
    const requests = createPreviewRequests();
    const first = requests.begin({ time: 1 });
    const second = requests.begin({ time: 2 });
    expect(first.isCurrent()).toBe(false);
    expect(first.finish()).toBe(false);
    expect(requests.pending).toBe(second.owner);
    expect(second.isCurrent()).toBe(true);
    expect(second.finish()).toBe(true);
    expect(requests.pending).toBe(null);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(false);
  });

  it("invalidates a closed preview and prevents a late result from reopening it", () => {
    const requests = createPreviewRequests();
    const request = requests.begin({ video: "a.mp4" });
    expect(requests.invalidate()).toBe(request.owner);
    expect(request.isPending()).toBe(false);
    expect(request.isCurrent()).toBe(false);
    expect(request.finish()).toBe(false);
    expect(requests.begin({ video: "a.mp4" }).isCurrent()).toBe(true);
  });

  it("keeps independent preview consumers from invalidating one another", () => {
    const first = createPreviewRequests();
    const second = createPreviewRequests();
    const request = second.begin({ video: "a.mp4" });
    first.begin({ video: "a.mp4" });
    first.invalidate();
    expect(request.isCurrent()).toBe(true);
  });
});
