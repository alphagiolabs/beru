import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDelogoRenderSession } from "../src/utils/delogo-render-core.js";

const width = 96;
const height = 64;
const ffmpeg = path.resolve("bin/ffmpeg.exe");
const region = { x: 31, y: 17, w: 23, h: 19 };

function run(command, args, input) {
  const result = spawnSync(command, args, { input, timeout: 30000 });
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result.stdout;
}

function inputPixels() {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = x >= 35 && x < 50 && y >= 20 && y < 32 ? 255 : 25 + ((17 * x + 13 * y) % 190);
      rgb.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return rgb;
}

function repairedPixels(input, op) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "beru-inpaint-parity-"));
  try {
    const source = path.join(directory, "marked.mkv");
    run(
      ffmpeg,
      [
        "-v",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        "96x64",
        "-r",
        "25",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-c:v",
        "ffv1",
        "-pix_fmt",
        "yuv444p",
        source,
      ],
      input,
    );
    const code = `import sys,json,subprocess;sys.path.insert(0,'python');from filters import build_filter_complex;from temporal_pipeline import TemporalPatchResolver,extra_media_input_args;ff,src,directory=sys.argv[1:4];resolver=TemporalPatchResolver(src,directory,ff,25,source_format='yuv444p');graph,label,media=build_filter_complex([json.loads(sys.argv[4])],96,64,source_pix_fmt='yuv444p',temporal_resolver=resolver);args=[ff,'-v','error','-i',src];[args.extend(extra_media_input_args(p)) for p in media];result=subprocess.run(args+['-filter_complex_threads','1','-filter_complex',graph,'-map',label,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],capture_output=True,check=True);sys.stdout.buffer.write(result.stdout)`;
    return run("python", ["-c", code, ffmpeg, source, directory, JSON.stringify(op)]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("quick logo kernels against real FFmpeg export", () => {
  it.each([18, 28, 38])("avoids sampling the compressed logo halo at H.264 CRF %i", (crf) => {
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < rgb.length; i += 3) rgb.set([40, 80, 120], i);
    for (let y = region.y; y < region.y + region.h; y++)
      for (let x = region.x; x < region.x + region.w; x++)
        rgb.set((x + y) % 2 ? [245, 245, 245] : [240, 30, 180], (y * width + x) * 3);
    const encoded = run(
      ffmpeg,
      [
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        "96x64",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-c:v",
        "libx264",
        "-crf",
        String(crf),
        "-pix_fmt",
        "yuv420p",
        "-f",
        "h264",
        "pipe:1",
      ],
      rgb,
    );
    const decoded = run(
      ffmpeg,
      [
        "-v",
        "error",
        "-f",
        "h264",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      encoded,
    );
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++)
      rgba.set([...decoded.subarray(i * 3, i * 3 + 3), 255], i * 4);
    const result = createDelogoRenderSession().compute(
      "inpaint",
      { box: region, feather: 4, guard: 2, referenceGuard: 3 },
      rgba,
      width,
      height,
    );
    let error = 0;
    for (let y = region.y; y < region.y + region.h; y++)
      for (let x = region.x; x < region.x + region.w; x++) {
        const i = (y * width + x) * 4;
        error +=
          Math.abs(result.data[i] - 40) +
          Math.abs(result.data[i + 1] - 80) +
          Math.abs(result.data[i + 2] - 120);
      }
    expect(error / (region.w * region.h * 3)).toBeLessThan(5);
  });
  it.each([
    ["inpaint", 0, 20],
    ["inpaint", 6, 20],
    ["inpaint", 40, 20],
    ["blur", 0, 1],
    ["blur", 6, 35],
    ["blur", 6, 100],
  ])("matches %s with feather=%i and strength=%i", (method, feather, strength) => {
    const input = inputPixels();
    const op = {
      mode: "delogo",
      delogo_method: method,
      region,
      edge_feather: feather,
      blur_strength: strength,
    };
    const code = `import sys,json; sys.path.insert(0,'python'); from processor import build_filter_complex; print(build_filter_complex([json.loads(sys.argv[1])],96,64)[0])`;
    const graph = run("python", ["-c", code, JSON.stringify(op)])
      .toString()
      .trim();
    const expected =
      method === "inpaint"
        ? repairedPixels(input, op)
        : run(
            ffmpeg,
            [
              "-v",
              "error",
              "-f",
              "rawvideo",
              "-pix_fmt",
              "rgb24",
              "-s",
              "96x64",
              "-i",
              "pipe:0",
              "-filter_complex",
              graph,
              "-map",
              "[tmp0]",
              "-frames:v",
              "1",
              "-pix_fmt",
              "rgb24",
              "-f",
              "rawvideo",
              "pipe:1",
            ],
            input,
          );
    const radius = Math.max(1, Math.floor(strength / 3));
    const pad = method === "inpaint" ? Math.max(2, feather) : feather;
    let sx = Math.max(0, Math.floor((region.x - pad) / 2) * 2);
    let sy = Math.max(0, Math.floor((region.y - pad) / 2) * 2);
    let right = Math.min(width, Math.ceil((region.x + region.w + pad) / 2) * 2);
    let bottom = Math.min(height, Math.ceil((region.y + region.h + pad) / 2) * 2);
    if (method === "blur") {
      sx = Math.max(0, sx - 3 * radius);
      sy = Math.max(0, sy - 3 * radius);
      sx = Math.floor(sx / 2) * 2;
      sy = Math.floor(sy / 2) * 2;
      right = Math.min(width, Math.ceil((right + 3 * radius) / 2) * 2);
      bottom = Math.min(height, Math.ceil((bottom + 3 * radius) / 2) * 2);
    } else {
      sx = Math.max(0, sx - 96);
      sy = Math.max(0, sy - 96);
      right = Math.min(width, right + 96);
      bottom = Math.min(height, bottom + 96);
    }
    const sw = right - sx;
    const sh = bottom - sy;
    const frame = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const i = ((sy + y) * width + sx + x) * 3;
        frame.set([...input.subarray(i, i + 3), 255], (y * sw + x) * 4);
      }
    const box = { x: region.x - sx, y: region.y - sy, w: region.w, h: region.h };
    const result = createDelogoRenderSession().compute(
      method,
      { box, feather, radius },
      frame,
      sw,
      sh,
    );
    let error = 0;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const i = ((sy + y) * width + sx + x) * 3;
        const j = (y * sw + x) * 4;
        const alpha = result.data[j + 3] / 255;
        for (let channel = 0; channel < 3; channel++) {
          const actual = result.data[j + channel] * alpha + input[i + channel] * (1 - alpha);
          error += Math.abs(actual - expected[i + channel]);
        }
      }
    expect(error / (sw * sh * 3)).toBeLessThan(2);
  });
});
