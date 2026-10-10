"""System font discovery and drawtext font resolution.

Patch font discovery helpers here, where callers resolve them.
"""

import logging
import os
import re
import threading
from pathlib import Path

from media_paths import FONT_EXTENSIONS, _path_parent, validate_media_path

logger = logging.getLogger("beru")

FONT_DIRS = []


def _init_font_dirs():
    global FONT_DIRS
    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or "C:/Windows"
    FONT_DIRS = [
        Path(windir) / "Fonts",
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Fonts",
    ]


_init_font_dirs()

_SYSTEM_FONTS_CACHE = None


def _windows_registry_fonts():
    """Return Windows font display names mapped to their installed files."""
    try:
        import winreg
    except ImportError:
        return {}

    fonts = {}
    registry_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            key = winreg.OpenKey(hive, registry_path)
        except OSError:
            continue
        try:
            value_count = winreg.QueryInfoKey(key)[1]
            for index in range(value_count):
                try:
                    display_name, raw_path, _kind = winreg.EnumValue(key, index)
                except OSError:
                    continue
                if not isinstance(display_name, str) or not isinstance(raw_path, str):
                    continue
                filename = raw_path.split(",", 1)[0].strip()
                font_path = Path(filename)
                if not font_path.is_absolute():
                    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or "C:/Windows"
                    font_path = Path(windir) / "Fonts" / filename
                if not font_path.exists():
                    continue
                if font_path.suffix.lower() not in FONT_EXTENSIONS:
                    continue

                clean_name = re.sub(r"\s+\([^)]*\)\s*$", "", display_name).strip()
                aliases = [clean_name]
                if " & " in clean_name:
                    aliases.extend(part.strip() for part in clean_name.split(" & "))
                for alias in aliases:
                    if alias:
                        fonts[alias.lower()] = (str(font_path), font_path.stem)
        finally:
            winreg.CloseKey(key)
    return fonts


def get_system_fonts():
    """Return a dict mapping lowercase font stem -> (full_path, stem).
    Cached globally for performance."""
    global _SYSTEM_FONTS_CACHE
    if _SYSTEM_FONTS_CACHE is not None:
        return _SYSTEM_FONTS_CACHE

    fonts = {}
    for font_dir in FONT_DIRS:
        if not font_dir.exists():
            continue
        for pattern in ["*.ttf", "*.otf", "*.ttc"]:
            for f in font_dir.rglob(pattern):
                stem = f.stem
                fonts[stem.lower()] = (str(f), stem)
    fonts.update(_windows_registry_fonts())
    _SYSTEM_FONTS_CACHE = fonts
    return fonts


def _font_name_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _font_style_candidates(font_family, font_weight=None, italic=False, bold=False):
    try:
        weight = int(font_weight)
    except (TypeError, ValueError):
        weight = 700 if bold else 400

    if weight <= 200:
        weights = ["thin", "light"]
    elif weight <= 350:
        weights = ["light"]
    elif weight <= 450:
        weights = []
    elif weight <= 550:
        weights = ["medium", "semibold"]
    elif weight <= 650:
        weights = ["semibold", "bold", "medium"]
    elif weight <= 800:
        weights = ["bold", "semibold"]
    else:
        weights = ["black", "bold"]

    candidates = []
    if italic:
        candidates.extend(f"{font_family} {label} italic" for label in weights)
        candidates.extend(f"{font_family} {label} oblique" for label in weights)
        candidates.extend([f"{font_family} italic", f"{font_family} oblique"])
    else:
        candidates.extend(f"{font_family} {label}" for label in weights)
    candidates.append(font_family)
    return candidates


_RESOLVE_FONT_CACHE_MAX = 256
_resolve_font_cache = {}
_resolve_font_cache_lock = threading.Lock()
_normalized_fonts_state = None


def _get_normalized_fonts(fonts):
    """Return the normalized-key view of `fonts`, built once per catalogue.

    Building it per `_resolve_font` call meant re-normalizing every installed
    font once per text operation, outside the lock that guards the cache it
    derives from. Keyed to the catalogue by identity, so a replaced catalogue
    (a font installed after the first call) is picked up automatically.
    """
    global _normalized_fonts_state
    state = _normalized_fonts_state
    if state is not None and state[0] is fonts:
        return state[1]
    normalized = {_font_name_key(name): value for name, value in fonts.items()}
    with _resolve_font_cache_lock:
        current = _normalized_fonts_state
        if current is not None and current[0] is fonts:
            return current[1]
        _normalized_fonts_state = (fonts, normalized)
        return normalized


def reset_caches():
    """Drop all memoized font state so the next lookup re-scans the system.

    Worker processes are persistent across runs; a font installed or deleted
    between runs must be seen by the next run's resolution.
    """
    global _SYSTEM_FONTS_CACHE, _normalized_fonts_state
    with _resolve_font_cache_lock:
        _SYSTEM_FONTS_CACHE = None
        _resolve_font_cache.clear()
        _normalized_fonts_state = None


def _resolve_font(font_family, font_weight=None, italic=False, bold=False):
    """Resolve a font family name to a fontfile path or fallback name.
    Returns (option_key, value, is_fontfile) where option_key is 'fontfile' or 'font'."""
    cache_key = (font_family, font_weight, italic, bold)

    def _format_fontfile(full_path):
        """Escape a font path for use in an FFmpeg drawtext filter option."""
        return full_path.replace("\\", "/").replace(":", "\\:")

    def _emit(result):
        # Cache entries hold the raw path so a hit can be re-verified.
        return (result[0], _format_fontfile(result[1]), True) if result[2] else result

    with _resolve_font_cache_lock:
        cached = _resolve_font_cache.get(cache_key)
        if cached is not None:
            if not cached[2] or os.path.isfile(cached[1]):
                return _emit(cached)
            _resolve_font_cache.pop(cache_key, None)

    fonts = get_system_fonts()
    normalized_fonts = _get_normalized_fonts(fonts)

    result = None
    for candidate in _font_style_candidates(font_family, font_weight, italic, bold):
        match = fonts.get(candidate.lower()) or normalized_fonts.get(_font_name_key(candidate))
        if match:
            full_path, _stem = match
            if os.path.isfile(full_path):
                validate_media_path(full_path, _path_parent(full_path), FONT_EXTENSIONS)
                result = ("fontfile", full_path, True)
                break
            logger.debug("Font file missing, skipping: %s", full_path)

    if result is None:
        key = _font_name_key(font_family)
        for fkey, (fpath, _) in fonts.items():
            normalized_key = _font_name_key(fkey)
            if key in normalized_key or normalized_key in key:
                if os.path.isfile(fpath):
                    validate_media_path(fpath, _path_parent(fpath), FONT_EXTENSIONS)
                    result = ("fontfile", fpath, True)
                    break
                logger.debug("Font file missing (partial), skipping: %s", fpath)

    if result is None:
        result = ("font", font_family, False)

    with _resolve_font_cache_lock:
        if len(_resolve_font_cache) >= _RESOLVE_FONT_CACHE_MAX:
            _resolve_font_cache.pop(next(iter(_resolve_font_cache)), None)
        _resolve_font_cache[cache_key] = result
    return _emit(result)
