"""FFmpeg 9 drawtext has no native letter spacing, so each digit is its own
``%{eif:...}`` expansion. That keeps every digit a separate glyph cluster and
lets the existing hair-space spacing fallback work on a template string where
private-use placeholders stand in for the digits.
"""

import math
from datetime import date

CLOCK_FORMATS = ("datetime", "date", "time")
CLOCK_LAYOUTS = ("single", "split")
CLOCK_DATE_STYLES = ("dmy", "mdy", "ymd")
MAX_CLOCK_EPOCH = (date.max.toordinal() + 1 - date(1970, 1, 1).toordinal()) * 86400

_PLACEHOLDER_BASE = 0xE000

# Civil-from-days (H. Hinnant) in FFmpeg expression syntax. Registers:
# 0 shifted day, 1 era, 2 day of era, 3 year of era, 4 day of year,
# 5 shifted month, 6 day, 7 month, 8 year.
_CIVIL_FROM_DAYS = (
    "st(0,floor(({clock})/86400)+719468);"
    "st(1,floor(ld(0)/146097));"
    "st(2,ld(0)-ld(1)*146097);"
    "st(3,floor((ld(2)-floor(ld(2)/1460)+floor(ld(2)/36524)-floor(ld(2)/146096))/365));"
    "st(4,ld(2)-(365*ld(3)+floor(ld(3)/4)-floor(ld(3)/100)));"
    "st(5,floor((5*ld(4)+2)/153));"
    "st(6,ld(4)-floor((153*ld(5)+2)/5)+1);"
    "st(7,ld(5)+if(lt(ld(5),10),3,-9));"
    "st(8,ld(3)+ld(1)*400+lte(ld(7),2));"
)


def parse_clock_epoch(value):
    if isinstance(value, bool):
        return None
    try:
        epoch = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(epoch) or not 0 <= epoch < MAX_CLOCK_EPOCH:
        return None
    return epoch


def normalize_clock_fields(op):
    out = dict(op)
    for snake, camel, allowed in (
        ("clock_format", "clockFormat", CLOCK_FORMATS),
        ("clock_layout", "clockLayout", CLOCK_LAYOUTS),
        ("clock_date_style", "clockDateStyle", CLOCK_DATE_STYLES),
    ):
        value = out.get(snake, out.get(camel))
        out[snake] = value if value in allowed else allowed[0]
    if out.get("clock_start_epoch") is None and out.get("clockStartEpoch") is not None:
        out["clock_start_epoch"] = out["clockStartEpoch"]
    return out


def shift_clock_epoch(op, offset):
    """Rebase the clock for a seek: ``-ss S`` makes filter ``t`` start at 0."""
    epoch = parse_clock_epoch(op.get("clock_start_epoch")) if isinstance(op, dict) else None
    if epoch is None or offset <= 0:
        return op
    return {**op, "clock_start_epoch": epoch + offset}


def _digit(value_expr, place):
    return f"mod(trunc(({value_expr})/{place}),10)"


def _date_tokens(clock, date_style):
    prefix = _CIVIL_FROM_DAYS.format(clock=clock)
    day = [prefix + _digit("ld(6)", 10), prefix + _digit("ld(6)", 1)]
    month = [prefix + _digit("ld(7)", 10), prefix + _digit("ld(7)", 1)]
    year = [prefix + _digit("ld(8)", p) for p in (1000, 100, 10, 1)]
    order = {"dmy": (day, month, year), "mdy": (month, day, year), "ymd": (year, month, day)}
    tokens = []
    for index, field in enumerate(order[date_style]):
        if index:
            tokens.append("/")
        tokens.extend(("expr", e) for e in field)
    return tokens


def _time_tokens(clock):
    hours = f"mod(floor(({clock})/3600),24)"
    minutes = f"mod(floor(({clock})/60),60)"
    seconds = f"mod(floor({clock}),60)"
    tokens = []
    for index, field in enumerate((hours, minutes, seconds)):
        if index:
            tokens.append(":")
        tokens += [("expr", _digit(field, 10)), ("expr", _digit(field, 1))]
    return tokens


def clock_parts(op):
    epoch = parse_clock_epoch(op.get("clock_start_epoch"))
    if epoch is None:
        return []
    clock = f"{epoch:.6f}+t"
    fmt = op.get("clock_format", "datetime")
    blocks = []
    if fmt in ("datetime", "date"):
        blocks.append(_date_tokens(clock, op.get("clock_date_style", "dmy")))
    if fmt in ("datetime", "time"):
        blocks.append(_time_tokens(clock))
    if op.get("clock_layout") == "single" and len(blocks) > 1:
        blocks = [blocks[0] + [" "] + blocks[1]]
    return blocks


def template_for_tokens(tokens):
    text = []
    expansions = {}
    for token in tokens:
        if isinstance(token, tuple):
            placeholder = chr(_PLACEHOLDER_BASE + len(expansions))
            expansions[placeholder] = f"%{{eif:{token[1]}:d}}"
            text.append(placeholder)
        else:
            text.append(token)
    return "".join(text), expansions


def _round_half_up(value):
    return math.floor(value + 0.5)


def split_clock_region(region, lengths, font_size, inset):
    count = len(lengths)
    if count <= 1:
        return [dict(region)] if count else []
    gap = max(2, _round_half_up(float(font_size) * 0.3))
    inner = max(0, region["w"] - gap * (count - 1) - 2 * inset * count)
    total = sum(lengths) or 1
    boxes = []
    x = region["x"]
    for index, length in enumerate(lengths):
        if index == count - 1:
            w = region["x"] + region["w"] - x
        else:
            w = 2 * inset + _round_half_up(inner * length / total)
        boxes.append({"x": x, "y": region["y"], "w": max(0, w), "h": region["h"]})
        x += w + gap
    return boxes
