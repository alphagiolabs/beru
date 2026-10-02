import { describe, expect, it } from "vitest";
import { parseFfprobeJson, parseFfmpegOutput } from "../main/videoProbe.js";

describe("display dimensions", () => {
  it.each([90, -90, 270])(
    "uses the autorotated frame size for a %s degree display matrix",
    (rotation) => {
      const result = parseFfprobeJson(
        JSON.stringify({
          streams: [
            { codec_type: "video", width: 160, height: 90, side_data_list: [{ rotation }] },
          ],
        }),
      );
      expect(result).toMatchObject({ width: 90, height: 160 });
    },
  );
  it("supports legacy rotate tags and keeps 180 degree dimensions", () => {
    const parse = (rotate) =>
      parseFfprobeJson(
        JSON.stringify({
          streams: [{ codec_type: "video", width: 160, height: 90, tags: { rotate } }],
        }),
      );
    expect(parse("90")).toMatchObject({ width: 90, height: 160 });
    expect(parse("180")).toMatchObject({ width: 160, height: 90 });
  });
  it("applies rotation when ffprobe is unavailable", () => {
    expect(
      parseFfmpegOutput(
        "Stream #0:0: Video: h264, yuv420p, 160x90, 25 fps\nSide data:\n displaymatrix: rotation of -90.00 degrees\n",
      ),
    ).toMatchObject({ width: 90, height: 160 });
  });
});
