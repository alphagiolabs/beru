#!/usr/bin/env python3
"""End-to-end delogo test: real ffmpeg encode, real pixel assertions.

The other delogo tests assert on filter-graph *strings* or a fakesrc that
never decodes a picture; this one runs the graph ``build_filter_complex``
produces through a real encode and measures decoded RGB afterwards. Fixtures
are generated at test time and decoded as rawvideo, so no binary fixture or
third-party package is needed. The untouched-region guard compares bit-exact
against a re-encode of the same input with the same encoder settings, so it
holds across ffmpeg builds instead of hiding behind a tolerance.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from processor import build_filter_complex, find_ffmpeg  # noqa: E402

VW, VH = 320, 180
FPS, DUR = 30, 2
LOGO = {"x": 120, "y": 60, "w": 56, "h": 32}
FLOOR = {"x": 10, "y": 110, "w": 30, "h": 20}
SAMPLE_FRAME = 1
BLUR_STRENGTH = 100
MIN_DOMINANCE_DROP = 100.0
INSET = 6

METHODS = {
    "temporal": {"delogo_method": "temporal", "temporal_radius": 3},
    "mirror": {"delogo_method": "mirror", "mirror_side": "right"},
    "mosaic": {"delogo_method": "mosaic", "mosaic_size": 12},
    "inpaint": {"delogo_method": "inpaint"},
    "blur": {"delogo_method": "blur", "blur_strength": BLUR_STRENGTH},
    "fill": {
        "delogo_method": "fill",
        "delogo_fill_color": "black",
        "delogo_fill_opacity": 1,
    },
}

_TMP = tempfile.TemporaryDirectory(prefix="beru_delogo_e2e_")
TMP = Path(_TMP.name)


def _resolve_ffmpeg():
    """Resolve the Windows FFmpeg binary from the bundle or PATH."""
    found = Path(find_ffmpeg())
    if found.exists():
        return found
    for name in ("ffmpeg", "ffmpeg.exe"):
        on_path = shutil.which(name)
        if on_path:
            return Path(on_path)
    return found


FFMPEG = _resolve_ffmpeg()


def run(cmd):
    return subprocess.run(
        [str(a) for a in cmd], capture_output=True, text=True, timeout=180
    )


def encode(src, dst, vf):
    result = run(
        [
            FFMPEG, "-y", "-i", src, "-vf", vf,
            "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-an", dst,
        ]
    )
    assert result.returncode == 0, f"{dst.name} encode failed: {result.stderr[-600:]}"
    assert dst.exists() and dst.stat().st_size > 0, f"no output written: {dst}"
    return dst


def make_base():
    result = run(
        [
            FFMPEG, "-y", "-f", "lavfi",
            "-i", f"color=c=blue:s={VW}x{VH}:rate={FPS}:duration={DUR}",
            "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-an", TMP / "base.mp4",
        ]
    )
    assert result.returncode == 0, f"base fixture failed: {result.stderr[-600:]}"
    return TMP / "base.mp4"


def sample(video, name):
    """Decode one frame to raw RGB24 (rawvideo needs no container parsing)."""
    raw = TMP / f"{name}.rgb"
    result = run(
        [
            FFMPEG, "-y", "-i", video,
            "-vf", f"select=eq(n\\,{SAMPLE_FRAME}),format=rgb24",
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw,
        ]
    )
    assert result.returncode == 0, f"sample {name} failed: {result.stderr[-400:]}"
    size = VW * VH * 3
    payload = raw.read_bytes()
    assert len(payload) == size, f"{name}: expected {size} bytes, got {len(payload)}"
    return payload


def delogo_op(method):
    return {"mode": "delogo", "region": dict(LOGO), "edge_feather": 6, **METHODS[method]}


def render(src, op, out):
    graph, label, _images = build_filter_complex([op], VW, VH)
    assert graph is not None, "build_filter_complex returned None"
    result = run(
        [
            FFMPEG, "-y", "-i", src, "-filter_complex", graph, "-map", label,
            "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-an", out,
        ]
    )
    assert result.returncode == 0, (
        f"render failed:\n{graph}\n{result.stderr[-800:]}"
    )
    assert out.exists() and out.stat().st_size > 0, f"no output: {out}"
    return graph


def dominance(pixels, region, inset=INSET):
    """Mean R - max(G,B) over a region."""
    x0, y0 = region["x"] + inset, region["y"] + inset
    x1, y1 = region["x"] + region["w"] - inset, region["y"] + region["h"] - inset
    total = 0
    count = 0
    for y in range(y0, y1):
        row = y * VW * 3
        for x in range(x0, x1):
            off = row + x * 3
            total += pixels[off] - max(pixels[off + 1], pixels[off + 2])
            count += 1
    assert count > 0, f"empty sample region {region} (inset {inset})"
    return total / count


def mean_distance(ref, test, region, inset=INSET):
    x0, y0 = region["x"] + inset, region["y"] + inset
    x1, y1 = region["x"] + region["w"] - inset, region["y"] + region["h"] - inset
    total = 0
    for y in range(y0, y1):
        row = y * VW * 3
        for x in range(x0, x1):
            off = row + x * 3
            total += abs(ref[off] - test[off])
            total += abs(ref[off + 1] - test[off + 1])
            total += abs(ref[off + 2] - test[off + 2])
    return total / (3 * (x1 - x0) * (y1 - y0))


def test_every_method_runs_real_ffmpeg(frames):
    for method in METHODS:
        out = TMP / f"out_{method}.mp4"
        graph = render(TMP / "with_logo.mp4", delogo_op(method), out)
        frames[method] = sample(out, method)
        print(
            f"  {method:<8} {out.stat().st_size:>7} bytes, "
            f"{len(graph)} char graph, box dominance "
            f"{dominance(frames[method], LOGO):7.1f}"
        )


def test_fixture_is_what_it_claims_to_be(frames):
    """Guards the guards: if the logo did not land, or the re-encode control
    already 'fixed' it, the dominance assertions below prove nothing."""
    logo_dom = dominance(frames["input"], LOGO)
    ctrl_dom = dominance(frames["control"], LOGO)
    assert logo_dom > 200, f"baked logo is not red enough: {logo_dom:.1f}"
    assert ctrl_dom < 0, f"logo-free control still reads red: {ctrl_dom:.1f}"
    print(f"  logo box: input {logo_dom:.1f} -> no-filter control {ctrl_dom:.1f}")


def test_blur_reduces_red_dominance(frames):
    in_dom = dominance(frames["input"], LOGO)
    out_dom = dominance(frames["blur"], LOGO)
    drop = in_dom - out_dom
    print(
        f"  blur strength {BLUR_STRENGTH}: dominance {in_dom:.1f} -> {out_dom:.1f} "
        f"(drop {drop:.1f})"
    )
    assert drop > MIN_DOMINANCE_DROP, (
        f"blur did not reduce red dominance in the target region: "
        f"{in_dom:.1f} -> {out_dom:.1f} (required drop > {MIN_DOMINANCE_DROP})"
    )
    dist_in = mean_distance(frames["control"], frames["input"], LOGO)
    dist_out = mean_distance(frames["control"], frames["blur"], LOGO)
    print(
        f"  distance to logo-free control: input {dist_in:.1f} -> blur {dist_out:.1f}"
    )
    assert dist_out < dist_in, (
        f"blur output is not closer to the logo-free frame: "
        f"{dist_in:.1f} -> {dist_out:.1f}"
    )


def test_far_region_is_untouched(frames):
    """The distinguishing assertion: the filter must be local. A chain that
    blurred, re-encoded or re-timed the whole frame would pass every dominance
    check above while destroying untouched footage."""
    control = frames["control"]
    x, y, w, h = FLOOR["x"], FLOOR["y"], FLOOR["w"], FLOOR["h"]
    for method in METHODS:
        pixels = frames[method]
        for row in range(y, y + h):
            start = (row * VW + x) * 3
            got = pixels[start : start + w * 3]
            want = control[start : start + w * 3]
            if got != want:
                first = next(i for i in range(len(got)) if got[i] != want[i])
                raise AssertionError(
                    f"{method}: far region changed at ({x + first // 3},{row}) "
                    f"channel {first % 3}: {got[first]} != {want[first]}"
                )
        print(f"  {method:<8} far region bit-identical to the no-filter control")


def main():
    if not FFMPEG.exists():
        print(f"[FAIL] ffmpeg not found (looked for {FFMPEG})")
        return 1
    print(f"ffmpeg: {FFMPEG}")
    print(f"workdir: {TMP}")

    base = make_base()
    x, y, w, h = LOGO["x"], LOGO["y"], LOGO["w"], LOGO["h"]
    encode(base, TMP / "with_logo.mp4",
           f"drawbox=x={x}:y={y}:w={w}:h={h}:color=red@1:t=fill")
    encode(base, TMP / "control.mp4", "null")
    frames = {
        "input": sample(TMP / "with_logo.mp4", "input"),
        "control": sample(TMP / "control.mp4", "control"),
    }

    tests = [
        test_every_method_runs_real_ffmpeg,
        test_fixture_is_what_it_claims_to_be,
        test_blur_reduces_red_dominance,
        test_far_region_is_untouched,
    ]
    failed = 0
    for test in tests:
        print(f"[{test.__name__}]")
        try:
            test(frames)
        except AssertionError as exc:
            failed += 1
            print(f"[FAIL] {test.__name__}: {exc}")
        else:
            print(f"[ok] {test.__name__}")
    print(f"delogo e2e: {len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
