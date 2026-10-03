#!/usr/bin/env python3
"""Seamless delogo: local smoothstep seams without invented grain.

Quality bar for "invisible" logo removal:
- inpaint / mirror / blur / fill / temporal with feather > 0 composite the
  cleaned patch through a looped static alpha mask via alphamerge (opaque
  interior, fading seam) so pixels outside the patch are never touched — no
  halo.
- inpaint limits reconstruction smoothing independently of seam width.
- feather = 0 keeps the exact hard-overlay path (sharp, predictable).

Quantitative guard: on synthetic textured footage with an opaque logo box,
the seamless inpaint chain must beat the previous whole-patch-boxblur chain
on halo-ring error while matching or improving interior and seam error.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from delogo_chains import (  # noqa: E402
    _build_delogo_chain,
    _fit_delogo_rect,
    _seamless_feather_widths,
)
from processor import build_filter_complex, find_ffmpeg  # noqa: E402

FFMPEG = Path(find_ffmpeg())
_TMP = tempfile.TemporaryDirectory(prefix="beru_delogo_seamless_")
TMP = Path(_TMP.name)
VW, VH = 320, 180
BOX = {"x": 220, "y": 15, "w": 80, "h": 35}
FPS = 30
DUR = 1
# Metrics and the baseline must use the builder's effective box.
_FX, _FY, _FW, _FH = _fit_delogo_rect(BOX["x"], BOX["y"], BOX["w"], BOX["h"], VW, VH)
EFF = {"x": _FX, "y": _FY, "w": _FW, "h": _FH}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=180)


def _op(method, feather, **kw):
    op = {
        "mode": "delogo",
        "region": dict(BOX),
        "delogo_method": method,
        "edge_feather": feather,
    }
    op.update(kw)
    return op


def test_seamless_feather_widths():
    assert _seamless_feather_widths(6, 6, 6, 6, 6) == (6, 6, 6, 6)
    assert _seamless_feather_widths(0, 6, 6, 6, 6) == (0, 0, 0, 0)
    assert _seamless_feather_widths(6, 0, 0, 6, 4) == (0, 0, 6, 4)
    assert _seamless_feather_widths(40, 10, 3, 20, 0) == (10, 3, 20, 0)


def test_feathered_methods_use_alpha_seam():
    for method in ("mirror", "fill"):
        chain = _build_delogo_chain(_op(method, 6), None, 0, VW, VH, None)
        assert chain is not None, f"{method}: no chain"
        assert "alphamerge" in chain, f"{method}: expected alpha seam (alphamerge), got: {chain}"
        assert "boxblur" not in chain, f"{method}: halo blur must be gone, got: {chain}"
    chain = _build_delogo_chain(_op("blur", 6), None, 0, VW, VH, None)
    assert chain is not None
    assert "alphamerge" in chain, f"blur: expected alpha seam (alphamerge), got: {chain}"
    assert chain.count("boxblur") == 1, f"blur: only the cleanup blur may remain: {chain}"
    chain = _build_delogo_chain(_op("inpaint", 6), None, 0, VW, VH, None)
    assert chain is not None
    assert "alphamerge" in chain, f"inpaint: expected alpha seam (alphamerge), got: {chain}"
    assert "noise=alls=" not in chain
    assert chain.count("boxblur") == 1, f"inpaint: only the interior blur may remain: {chain}"


def test_inpaint_delogos_the_patch_not_the_frame():
    """Composite inpaint paths should crop the padded patch first and run
    ``delogo`` inside it (patch-local coords) — identical output at O(patch)
    instead of O(frame) per frame. Only when the patch offset is even: odd
    offsets realign subsampled chroma and must keep the full-frame delogo."""
    op = _op("inpaint", 6)
    op["region"] = {"x": 100, "y": 60, "w": 40, "h": 20}
    chain = _build_delogo_chain(op, None, 0, 640, 360, None)
    assert chain is not None
    assert "delogo=x=6:y=6:w=40:h=20" in chain, f"expected patch-local delogo: {chain}"
    assert "delogo=x=100:y=60" not in chain
    chain = _build_delogo_chain(_op("inpaint", 6), None, 0, VW, VH, None)
    assert chain is not None
    assert "delogo=x=6:y=7:w=80:h=35" in chain, chain


def test_time_bounded_cleanup_carries_enable_when_stateless():
    """Time-bounded ops gate the per-pixel cleanup work, not just the final
    overlay — but only on stateless timeline-capable filters. Scale has
    no timeline support."""
    chain = _build_delogo_chain(
        _op("blur", 0, start_time=0.5, end_time=2.0), None, 0, VW, VH, None
    )
    assert "chroma_power=3:enable=between(t\\,0.500000\\,2.000000)" in chain, chain
    chain = _build_delogo_chain(
        _op("fill", 0, start_time=0.5, end_time=2.0), None, 0, VW, VH, None
    )
    assert "t=fill:enable=between(t\\,0.500000\\,2.000000)" in chain, chain
    chain = _build_delogo_chain(
        _op("mosaic", 0, start_time=0.5, end_time=2.0), None, 0, VW, VH, None
    )
    assert "neighbor:enable" not in chain, chain


def test_feather_zero_keeps_hard_overlay():
    for method in ("inpaint", "mirror", "blur", "fill"):
        chain = _build_delogo_chain(_op(method, 0), None, 0, VW, VH, None)
        assert chain is not None, f"{method}: no chain"
        if method != "blur":
            assert "alphamerge" not in chain, f"{method}: feather=0 must stay a hard overlay"
        assert ("overlay=" in chain) or ("delogo=x=" in chain)


def test_frame_edge_feather_uses_the_available_sides():
    op = _op("blur", 6, blur_strength=30)
    op["region"] = {"x": 0, "y": 0, "w": 80, "h": 35}
    chain = _build_delogo_chain(op, None, 0, VW, VH, None)
    assert chain is not None
    assert "crop=86:42:0:0" in chain
    assert "alphamerge" in chain, f"frame edge disabled feather on every side: {chain}"


def _old_inpaint_chain(x, y, w, h, feather):
    """Previous behavior kept as the quality baseline: delogo on the
    effective box, then a whole-patch boxblur(feather) overlaid on the padded
    region (halo)."""
    pad = max(2, feather)
    x0, y0 = max(0, x - pad), max(0, y - pad)
    rw, rh = min(VW, x + w + pad) - x0, min(VH, y + h + pad) - y0
    bb = (
        f"boxblur=luma_radius=min({feather}\\,min(w\\,h)/2):luma_power=1:"
        f"chroma_radius=min({feather}\\,min(cw\\,ch)/2):chroma_power=1"
    )
    return (
        "[0:v]split[fulld0][workd0];"
        f"[workd0]delogo=x={x}:y={y}:w={w}:h={h}[work_cleand0];"
        f"[work_cleand0]crop={rw}:{rh}:{x0}:{y0}[cropd0];"
        f"[cropd0]{bb}[softd0];"
        f"[fulld0][softd0]overlay={x0}:{y0}[tmp0]"
    )


def _make_sources():
    truth = TMP / "truth.mp4"
    logo = TMP / "logo.mp4"
    r = run([
        str(FFMPEG), "-y", "-f", "lavfi",
        "-i", f"testsrc2=s={VW}x{VH}:rate={FPS}:duration={DUR}",
        "-vf", "noise=alls=7:allf=t",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(truth),
    ])
    assert r.returncode == 0, f"truth failed: {r.stderr[-500:]}"
    x, y, w, h = BOX["x"], BOX["y"], BOX["w"], BOX["h"]
    r = run([
        str(FFMPEG), "-y", "-i", str(truth),
        "-vf",
        f"drawbox=x={x}:y={y}:w={w}:h={h}:color=white@1:t=fill,"
        f"drawbox=x={x + 8}:y={y + 8}:w={w - 16}:h={h - 16}:color=black@1:t=fill",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(logo),
    ])
    assert r.returncode == 0, f"logo failed: {r.stderr[-500:]}"
    return truth, logo


def _render(src, fc, label, name):
    out = TMP / name
    r = run([
        str(FFMPEG), "-y", "-i", str(src),
        "-filter_complex", fc, "-map", label,
        "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-an", str(out),
    ])
    assert r.returncode == 0, f"render {name} failed:\n{fc}\n{r.stderr[-1500:]}"
    return out


def _raw_frames(path, n=3):
    import numpy as np
    frames = []
    for i in range(n):
        t = 0.2 + i * (DUR - 0.4) / max(1, n - 1)
        ppm = TMP / f"{path.stem}_{i}.ppm"
        r = run([
            str(FFMPEG), "-y", "-ss", f"{t:.3f}", "-i", str(path),
            "-vf", "format=rgb24", "-frames:v", "1", str(ppm),
        ])
        assert r.returncode == 0
        data = ppm.read_bytes()
        idx = data.find(b"255\n")
        dims = data[:idx].split()
        w, h = int(dims[1]), int(dims[2])
        frames.append(
            np.frombuffer(data[idx + 4:idx + 4 + w * h * 3], dtype=np.uint8)
            .reshape(h, w, 3).astype(float)
        )
    return frames


def _metrics(truth_frames, out_frames):
    import numpy as np
    x, y, w, h = EFF["x"], EFF["y"], EFF["w"], EFF["h"]
    inter, halo, seam = [], [], []
    for t, o in zip(truth_frames, out_frames):
        d = (o - t) ** 2
        inter.append(d[y + 2:y + h - 2, x + 2:x + w - 2].mean())
        ring = np.zeros((VH, VW), bool)
        ring[max(0, y - 8):y + h + 8, max(0, x - 8):x + w + 8] = True
        ring[y:y + h, x:x + w] = False
        halo.append(d[ring].mean())
        border = np.zeros((VH, VW), bool)
        border[y:y + 1, x:x + w] = True
        border[y + h - 1:y + h, x:x + w] = True
        border[y:y + h, x:x + 1] = True
        border[y:y + h, x + w - 1:x + w] = True
        seam.append(np.abs(o - t)[border].mean())
    return float(np.mean(inter)), float(np.mean(halo)), float(np.mean(seam))


def test_seamless_inpaint_beats_halo_baseline():
    assert FFMPEG.exists(), f"ffmpeg not found at {FFMPEG}"
    truth, logo = _make_sources()
    truth_f = _raw_frames(truth)
    logo_f = _raw_frames(logo)
    floor = _metrics(truth_f, logo_f)
    x, y, w, h = EFF["x"], EFF["y"], EFF["w"], EFF["h"]
    old = _metrics(truth_f, _raw_frames(_render(
        logo, _old_inpaint_chain(x, y, w, h, 6), "[tmp0]", "old.mp4")))
    fc, label, _ = build_filter_complex([_op("inpaint", 6)], VW, VH)
    new = _metrics(truth_f, _raw_frames(_render(logo, fc, label, "new.mp4")))
    print(f"  floor(input) interior={floor[0]:.1f} halo={floor[1]:.1f} seam={floor[2]:.1f}")
    print(f"  old interior={old[0]:.1f} halo={old[1]:.1f} seam={old[2]:.1f}")
    print(f"  new interior={new[0]:.1f} halo={new[1]:.1f} seam={new[2]:.1f}")
    assert new[1] <= floor[1] * 1.5, f"halo above input floor: {floor[1]:.1f} -> {new[1]:.1f}"
    assert new[1] < old[1] * 0.5, f"halo not reduced: {old[1]:.1f} -> {new[1]:.1f}"
    # Heavy blur can lower MSE by flattening texture. Limit that tradeoff to
    # 10% here; static flicker and blur context have independent pixel guards
    # in test_delogo_quality.py and the benchmark reports detail error.
    assert new[0] <= old[0] * 1.10, f"interior regressed: {old[0]:.1f} -> {new[0]:.1f}"
    assert new[2] <= old[2] * 1.15, f"seam regressed: {old[2]:.1f} -> {new[2]:.1f}"


def test_seamless_blend_with_time_range_renders():
    assert FFMPEG.exists(), f"ffmpeg not found at {FFMPEG}"
    truth, logo = _make_sources()
    op = _op("inpaint", 6, startTime=0.1, endTime=0.9)
    fc, label, _ = build_filter_complex([op], VW, VH)
    assert "alphamerge" in fc and "enable=" in fc
    _render(logo, fc, label, "ranged.mp4")


def main():
    tests = [
        test_seamless_feather_widths,
        test_feathered_methods_use_alpha_seam,
        test_feather_zero_keeps_hard_overlay,
        test_frame_edge_feather_uses_the_available_sides,
        test_inpaint_delogos_the_patch_not_the_frame,
        test_time_bounded_cleanup_carries_enable_when_stateless,
        test_seamless_inpaint_beats_halo_baseline,
        test_seamless_blend_with_time_range_renders,
    ]
    failed = 0
    for t in tests:
        try:
            t()
        except AssertionError as e:
            failed += 1
            print(f"[FAIL] {t.__name__}: {e}")
        else:
            print(f"[ok] {t.__name__}")
    print(f"seamless: {len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
