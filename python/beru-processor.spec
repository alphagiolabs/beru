"""PyInstaller spec for the bundled Beru video processor (Windows x64)."""

from pathlib import Path

block_cipher = None
script_dir = Path(SPECPATH)
project_root = script_dir.parent
profiles_json = project_root / "resources" / "encode-profiles.json"

if not profiles_json.is_file():
    raise SystemExit(f"encode-profiles.json not found: {profiles_json}")

datas = [(str(profiles_json), "resources")]

a = Analysis(
    ["processor.py"],
    pathex=[str(script_dir)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "numpy",
        "encode_profiles",
        "batch_errors",
        "batch_context",
        "capacity",
        "encoders",
        "encode_args",
        "ffmpeg_runner",
        "filters",
        "fonts",
        "job_classify",
        "media_paths",
        "media_probe",
        "op_shared",
        "preview",
        "temporal_motion",
        "temporal_pipeline",
        "spatial_inpaint",
        "color_validation",
        "delogo_chains",
        "text_layout_helpers",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="beru-processor",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
