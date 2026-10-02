import { describe, it, expect } from "vitest";
import { buildLogoPreviewJob } from "../src/utils/delogo-ops.js";
import {
  createJobSignatureCache,
  normalizeJobTimestamp,
  stampJobTimestamp,
} from "../src/utils/job-signature.js";

function jobFor({ ops, watermark = null, ts }) {
  return {
    id: 0,
    input_path: "C:/clip.mp4",
    output_path: "C:/out/clip_beru.mp4",
    operations: ops,
    watermark,
    timestamp: ts,
  };
}

function trackedBuild(inputs, counter) {
  return () => {
    counter.calls++;
    return jobFor({ ...inputs, ts: normalizeJobTimestamp(inputs.ts) });
  };
}

describe("normalizeJobTimestamp", () => {
  it("keeps finite non-negative values and floors the rest to zero", () => {
    expect(normalizeJobTimestamp(1.5)).toBe(1.5);
    expect(normalizeJobTimestamp("2")).toBe(2);
    expect(normalizeJobTimestamp(0)).toBe(0);
    expect(normalizeJobTimestamp(-1)).toBe(0);
    expect(normalizeJobTimestamp(NaN)).toBe(0);
    expect(normalizeJobTimestamp(Infinity)).toBe(0);
  });
});

describe("createJobSignatureCache", () => {
  it("re-stamps moving timestamps byte-identically without rebuilding", () => {
    const counter = { calls: 0 };
    const cache = createJobSignatureCache();
    const inputs = { ops: [{ mode: "blur", blur_strength: 20 }], ts: 0 };
    const build = trackedBuild(inputs, counter);
    const entries = [inputs.ops];

    for (const ts of [0, 0.033, 2.5]) {
      inputs.ts = ts;
      expect(cache(entries, ts, build)).toBe(JSON.stringify(jobFor({ ...inputs, ts })));
    }
    expect(counter.calls).toBe(1);
  });

  it("skips the rebuild when entries and timestamp both hold", () => {
    const counter = { calls: 0 };
    const cache = createJobSignatureCache();
    const inputs = { ops: [{ mode: "text", text: "Hola" }], ts: 4 };
    const build = trackedBuild(inputs, counter);
    const entries = [inputs.ops];

    const first = cache(entries, 4, build);
    expect(cache(entries, 4, build)).toBe(first);
    expect(counter.calls).toBe(1);
  });

  it("rebuilds when an entry changes", () => {
    const counter = { calls: 0 };
    const cache = createJobSignatureCache();
    const inputs = { ops: [{ mode: "blur", blur_strength: 20 }], ts: 0 };
    const build = trackedBuild(inputs, counter);

    const first = cache([inputs.ops], 0, build);
    inputs.ops = [{ mode: "blur", blur_strength: 60 }];
    const second = cache([inputs.ops], 0, build);
    expect(second).not.toBe(first);
    expect(counter.calls).toBe(2);
  });

  it("treats value-equal rebuilt entries as unchanged", () => {
    const counter = { calls: 0 };
    const cache = createJobSignatureCache();
    const build = trackedBuild({ ops: [], ts: 0 }, counter);

    cache([{ fontSize: 12, fontColor: "#fff" }], 0, build);
    cache([{ fontSize: 12, fontColor: "#fff" }], 1, build);
    expect(counter.calls).toBe(1);

    cache([{ fontSize: 13, fontColor: "#fff" }], 1, build);
    expect(counter.calls).toBe(2);
  });

  it("falls back to full stringifies when the timestamp is not the last key", () => {
    const counter = { calls: 0 };
    const cache = createJobSignatureCache();
    const body = { id: 0, operations: [{ mode: "blur" }] };
    const inputs = { ts: 0 };
    const buildOdd = () => {
      counter.calls++;
      return { timestamp: normalizeJobTimestamp(inputs.ts), ...body };
    };
    const entries = [body.operations];

    for (const ts of [0, 1, 1]) {
      inputs.ts = ts;
      expect(cache(entries, ts, buildOdd)).toBe(JSON.stringify({ timestamp: ts, ...body }));
    }
    expect(counter.calls).toBe(2);
  });

  it("clears the cache when the job cannot be built", () => {
    const cache = createJobSignatureCache();
    expect(cache([1], 0, () => null)).toBeNull();
    const build = trackedBuild({ ops: [{ mode: "crop" }], ts: 0 }, { calls: 0 });
    expect(cache([1], 0, build)).toBe(JSON.stringify(jobFor({ ops: [{ mode: "crop" }], ts: 0 })));
  });

  it("normalizes raw timestamps when re-stamping", () => {
    const counter = { calls: 0 };
    const cache = createJobSignatureCache();
    const inputs = { ops: [{ mode: "blur" }], ts: -1 };
    const build = trackedBuild(inputs, counter);
    const entries = [inputs.ops];

    expect(cache(entries, -1, build)).toBe(JSON.stringify(jobFor({ ...inputs, ts: 0 })));
    inputs.ts = "2";
    expect(cache(entries, "2", build)).toBe(JSON.stringify(jobFor({ ...inputs, ts: 2 })));
    inputs.ts = -1;
    expect(cache(entries, -1, build)).toBe(JSON.stringify(jobFor({ ...inputs, ts: 0 })));
    expect(counter.calls).toBe(1);
  });

  it("stays byte-identical after buildLogoPreviewJob appends a draft op", () => {
    const counter = { calls: 0 };
    const cache = createJobSignatureCache();
    const ops = [{ mode: "text", text: "Hola" }];
    const draft = { mode: "blur", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, blurStrength: 30 };
    let ts = 0;
    const makeJob = (t) =>
      stampJobTimestamp(
        { id: 0, input_path: "C:/clip.mp4", width: 1920, height: 1080, operations: ops },
        t,
      );
    const build = () => {
      counter.calls++;
      return buildLogoPreviewJob(makeJob(ts), draft);
    };
    const entries = [ops, draft];

    for (const next of [0, 1.5, 2.5]) {
      ts = next;
      const wrapped = buildLogoPreviewJob(makeJob(ts), draft);
      expect(Object.keys(wrapped).at(-1)).toBe("timestamp");
      expect(cache(entries, ts, build)).toBe(JSON.stringify(wrapped));
    }
    expect(counter.calls).toBe(1);
  });
});
