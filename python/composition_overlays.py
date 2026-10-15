"""Composition title and image layers, shared by exports and exact frames."""
import os
import re
import shutil
import tempfile

OVERLAY_KINDS = frozenset({"text", "image"})
OVERLAY_MAX_COUNT = 50
OVERLAY_TEXT_MAX_LENGTH = 500
OVERLAY_SIZE_MIN = 0.01
OVERLAY_SIZE_MAX = 0.5
TEXT_FONT_FAMILIES = ("Arial", "Segoe UI")
TEXT_ALIGNS = ("left", "center", "right")
OVERLAY_OUTLINE_MAX = 0.25
SHADOW_OFFSET = 0.06
SIDE_PAD = 0.25
TEXT_STYLE_DEFAULTS = {
    "color": "#ffffff",
    "size": 0.06,
    "fontFamily": "Arial",
    "bold": False,
    "italic": False,
    "textAlign": "center",
    "textOpacity": 1,
    "borderWidth": 0.0625,
    "borderColor": "#000000",
    "textShadowEnabled": False,
    "textShadowColor": "#000000",
    "bgEnabled": False,
    "bgColor": "#000000",
    "bgOpacity": 0.65,
}
WINDOWS_FONTS = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
TEXT_FONT_FILES = {
    ("Arial", False, False): "arial.ttf",
    ("Arial", True, False): "arialbd.ttf",
    ("Arial", False, True): "ariali.ttf",
    ("Arial", True, True): "arialbi.ttf",
    ("Segoe UI", False, False): "segoeui.ttf",
    ("Segoe UI", True, False): "segoeuib.ttf",
    ("Segoe UI", False, True): "segoeuii.ttf",
    ("Segoe UI", True, True): "segoeuiz.ttf",
}
FONT_FALLBACKS = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial.ttf",
)
HEX_COLOR = re.compile(r"^#([0-9a-fA-F]{6})$")

class CompositionError(Exception):
    pass

def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)

def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)

def _unit(value, high=1.0):
    return _is_number(value) and 0 <= value <= high

def validate_text_style(style):
    colors = [style["color"], style["borderColor"], style["textShadowColor"], style["bgColor"]]
    if not all(isinstance(color, str) and HEX_COLOR.match(color) for color in colors):
        raise CompositionError("El color del título debe ser #rrggbb")
    size = style["size"]
    if not (_is_number(size) and OVERLAY_SIZE_MIN <= size <= OVERLAY_SIZE_MAX):
        raise CompositionError("El tamaño del título está fuera de rango")
    if style["fontFamily"] not in TEXT_FONT_FAMILIES:
        raise CompositionError("La fuente del título no está disponible")
    if not isinstance(style["bold"], bool) or not isinstance(style["italic"], bool):
        raise CompositionError("La negrita y la cursiva deben ser booleanos")
    if style["textAlign"] not in TEXT_ALIGNS:
        raise CompositionError("La alineación del título es inválida")
    if not _unit(style["textOpacity"]):
        raise CompositionError("La opacidad del título está fuera de rango")
    if not _unit(style["borderWidth"], OVERLAY_OUTLINE_MAX):
        raise CompositionError("El contorno del título está fuera de rango")
    if not isinstance(style["textShadowEnabled"], bool) or not isinstance(style["bgEnabled"], bool):
        raise CompositionError("La sombra y el fondo deben ser booleanos")
    if not _unit(style["bgOpacity"]):
        raise CompositionError("La opacidad del fondo está fuera de rango")

def validate_overlay(overlay):
    kind = overlay.get("kind")
    if kind not in OVERLAY_KINDS:
        raise CompositionError("Tipo de superposición inválido")
    start, end = overlay.get("startUs"), overlay.get("endUs")
    if not (_is_int(start) and _is_int(end) and 0 <= start < end):
        raise CompositionError("Intervalo de superposición inválido")
    geometry = overlay.get("geometry") or {}
    x, y, w, h = (geometry.get(k) for k in ("x", "y", "w", "h"))
    if not all(_is_number(v) for v in (x, y, w, h)):
        raise CompositionError("geometría fuera del lienzo")
    if not (0 <= x <= 1 and 0 <= y <= 1 and w > 0 and h > 0):
        raise CompositionError("geometría fuera del lienzo")
    if x + w > 1 + 1e-9 or y + h > 1 + 1e-9:
        raise CompositionError("geometría fuera del lienzo")
    if kind == "text":
        text = overlay.get("text")
        if not isinstance(text, str) or not text.strip():
            raise CompositionError("El texto del título está vacío")
        if len(text) > OVERLAY_TEXT_MAX_LENGTH:
            raise CompositionError(f"El texto supera {OVERLAY_TEXT_MAX_LENGTH} caracteres")
        validate_text_style(overlay_style(overlay))
    else:
        path = (overlay.get("source") or {}).get("path")
        if not isinstance(path, str) or not os.path.isabs(path):
            raise CompositionError("La ruta de la imagen debe ser absoluta")

def overlay_text_file(index):
    return f"overlay-{index}.txt"

def _title_options(index, style, size, box):
    """drawtext options for one title. `box` is the title's (x, y, w, h) in canvas pixels; the text is aligned in it."""
    box_x, box_y, box_w, box_h = box
    opacity = f"@{style['textOpacity']:.3f}" if style["textOpacity"] < 1 else ""
    options = [
        f"fontfile={overlay_font_file(style)}",
        f"textfile={overlay_text_file(index)}",
        f"fontsize={size}",
        f"fontcolor=0x{style['color'][1:]}{opacity}",
        f"text_align={style['textAlign']}",
    ]
    if style["borderWidth"] > 0:
        border = max(1, round(size * style["borderWidth"]))
        options.append(f"borderw={border}:bordercolor=0x{style['borderColor'][1:]}")
    if style["textShadowEnabled"]:
        offset = max(1, round(size * SHADOW_OFFSET))
        options.append(f"shadowx={offset}:shadowy={offset}:shadowcolor=0x{style['textShadowColor'][1:]}")
    pad = 0 if style["textAlign"] == "center" else round(size * SIDE_PAD)
    if style["textAlign"] == "left":
        x = f"{box_x:.3f}+{pad}"
    elif style["textAlign"] == "right":
        x = f"{box_x + box_w:.3f}-{pad}-text_w"
    else:
        x = f"{box_x:.3f}+({box_w:.3f}-text_w)/2"
    options += [f"x={x}", f"y={box_y:.3f}+({box_h:.3f}-text_h)/2"]
    return ":".join(options)

def build_overlay_filters(overlays, *, width, height, first_image_input):
    """Draws each overlay over the montage, in list order, and ends on [vout].

    A text overlay is centred in its box and drawn with drawtext; an image overlay is scaled to fit
    its box and placed at the box's top-left. Both are visible only on [startUs, endUs) of the montage
    clock. Image layers take the inputs that follow the clips, one per image overlay in order.
    """
    parts = []
    label = "[vcat]"
    image_input = first_image_input
    for i, overlay in enumerate(overlays):
        start_s = overlay["startUs"] / 1_000_000
        end_s = overlay["endUs"] / 1_000_000
        enable = f"enable='gte(t,{start_s:.6f})*lt(t,{end_s:.6f})'"
        geometry = overlay["geometry"]
        box_x = geometry["x"] * width
        box_y = geometry["y"] * height
        box_w = geometry["w"] * width
        box_h = geometry["h"] * height
        out = f"[ov{i}]"
        if overlay["kind"] == "text":
            style = overlay_style(overlay)
            size = max(1, round(style["size"] * height))
            if style["bgEnabled"]:
                parts.append(
                    f"{label}drawbox=x={box_x:.3f}:y={box_y:.3f}:w={box_w:.3f}:h={box_h:.3f}"
                    f":color=0x{style['bgColor'][1:]}@{style['bgOpacity']:.3f}:t=fill:{enable}[box{i}]"
                )
                label = f"[box{i}]"
            options = _title_options(i, style, size, (box_x, box_y, box_w, box_h))
            parts.append(f"{label}drawtext={options}:{enable}{out}")
        else:
            layer = f"[img{i}]"
            parts.append(
                f"[{image_input}:v]format=rgba,"
                f"scale=w={max(2, round(box_w))}:h={max(2, round(box_h))}"
                f":force_original_aspect_ratio=decrease{layer}"
            )
            # The logo loops forever; shortest=1 ends the layer with the montage it sits on.
            parts.append(
                f"{label}{layer}overlay=x={round(box_x)}:y={round(box_y)}:shortest=1:{enable}{out}"
            )
            image_input += 1
        label = out
    parts.append(f"{label}null[vout]")
    return parts

def image_input_args(overlays):
    """One looped input per image layer. The layer ends with the montage, so the loop never ends the output."""
    args = []
    for overlay in overlays:
        if overlay["kind"] == "image":
            args += ["-loop", "1", "-i", overlay["source"]["path"]]
    return args

def overlays_at_frame(overlays, at_us):
    """Overlays visible at one instant, re-timed so that instant is t=0 of the frame's graph."""
    return [
        {**overlay, "startUs": 0, "endUs": overlay["endUs"] - at_us}
        for overlay in overlays
        if overlay["startUs"] <= at_us < overlay["endUs"]
    ]

def overlay_style(overlay):
    """The title's style with Beru's defaults filled in; documents saved before the text options hold fewer keys."""
    return {**TEXT_STYLE_DEFAULTS, **(overlay.get("style") or {})}

def overlay_font_file(style):
    """Working-directory name of the font a title uses. drawtext reads it there, so no path is escaped."""
    family = style["fontFamily"].lower().replace(" ", "-")
    return f"font-{family}-{int(style['bold'])}{int(style['italic'])}.ttf"

def _font_path(family, bold, italic):
    """The installed file for a family and style; a regular cut or any fallback stands in when it is missing."""
    for name in (TEXT_FONT_FILES[(family, bold, italic)], TEXT_FONT_FILES[(family, False, False)]):
        path = os.path.join(WINDOWS_FONTS, name)
        if os.path.isfile(path):
            return path
    for path in FONT_FALLBACKS:
        if os.path.isfile(path):
            return path
    raise CompositionError("No hay una fuente disponible para los títulos")

def prepare_overlay_workdir(overlays, scratch_dir=None):
    """Copies the fonts and writes each title's text into a fresh directory; None when there is no title.

    The directory is created inside `scratch_dir` when one is given, so the caller that owns it can remove
    it even if this process is killed. Otherwise the caller removes it with `shutil.rmtree` when the render ends.
    """
    if not any(overlay["kind"] == "text" for overlay in overlays):
        return None
    workdir = tempfile.mkdtemp(prefix="beru-overlays-", dir=scratch_dir)
    try:
        copied = set()
        for i, overlay in enumerate(overlays):
            if overlay["kind"] != "text":
                continue
            style = overlay_style(overlay)
            name = overlay_font_file(style)
            if name not in copied:
                shutil.copyfile(
                    _font_path(style["fontFamily"], style["bold"], style["italic"]),
                    os.path.join(workdir, name),
                )
                copied.add(name)
            text = overlay["text"].replace("\r\n", "\n")
            with open(os.path.join(workdir, overlay_text_file(i)), "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
    except BaseException:
        shutil.rmtree(workdir, ignore_errors=True)
        raise
    return workdir
