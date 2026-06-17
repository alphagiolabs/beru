"""Encode profile contract — keep in sync with main/encodeProfiles.js via resources/encode-profiles.json."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_DEFAULT_PROFILE = "balanced"
_VALID_PROFILES = frozenset({"fast", "balanced", "quality", "uquality"})


def _encode_profiles_json_path() -> Path:
    env_path = os.environ.get("BERU_ENCODE_PROFILES")
    if env_path:
        candidate = Path(env_path)
        if candidate.is_file():
            return candidate

    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", ""))
        for rel in ("resources/encode-profiles.json", "encode-profiles.json"):
            candidate = meipass / rel
            if candidate.is_file():
                return candidate

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    candidates = (
        project_root / "resources" / "encode-profiles.json",
        project_root / "encode-profiles.json",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "encode-profiles.json not found; expected under resources/ or project root"
    )


def _load_contract() -> dict:
    with _encode_profiles_json_path().open(encoding="utf-8") as handle:
        return json.load(handle)


def _normalize_profiles(raw: dict) -> dict[str, dict]:
    profiles: dict[str, dict] = {}
    for name, spec in (raw.get("profiles") or {}).items():
        key = (name or "").strip().lower()
        if key not in _VALID_PROFILES:
            continue
        software = spec.get("software") or {}
        entry = {
            "crf": software.get("crf"),
            "preset": software.get("preset"),
            "allows_hardware": bool(spec.get("allowsHardware")),
        }
        hardware = spec.get("hardware")
        if hardware:
            entry["hw_cq"] = hardware.get("hwCq")
            entry["nvenc_preset"] = hardware.get("nvencPreset")
        profiles[key] = entry
    if _DEFAULT_PROFILE not in profiles:
        raise ValueError(f"encode-profiles.json must define {_DEFAULT_PROFILE!r}")
    return profiles


_CONTRACT = _load_contract()
ENCODE_PROFILES = _normalize_profiles(_CONTRACT)


def normalize_encode_profile(name: str | None) -> str:
    key = (name or _DEFAULT_PROFILE).strip().lower()
    if key in _VALID_PROFILES:
        return key
    return _DEFAULT_PROFILE


def profile_allows_hardware(profile_name: str | None) -> bool:
    profile = normalize_encode_profile(profile_name)
    return bool(ENCODE_PROFILES.get(profile, {}).get("allows_hardware"))


def effective_hw_encoder(profile_name: str | None, hw_encoder: str | None) -> str | None:
    if not profile_allows_hardware(profile_name):
        return None
    return hw_encoder or None
