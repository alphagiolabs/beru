import os


def is_hardware_encode_error(stderr_text):
    """Detect hardware encoder failures and related GPU/resource errors."""
    if not stderr_text:
        return False
    lower = stderr_text.lower()
    markers = (
        "nvenc",
        "amf",
        "qsv",
        "videotoolbox",
        "vaapi",
        "h264_mf",
        "hwaccel",
        "error code: -22",
        # NOTE: "operation not permitted" (POSIX EPERM) was previously listed
        # here, but it is a file/folder permission error, NOT a GPU failure.
        # Classifying it as hardware gave users the wrong message ("update GPU
        # drivers") for a permissions problem. It is handled by the
        # permissions branch of format_processing_error instead.
        "no capable devices",
        "cannot create cuda",
        "encoder init",
        "failed to initialize",
        "cannot load nvcuda",
        "cuda error",
    )
    return any(m in lower for m in markers)


def is_resource_pressure_error(stderr_text):
    """Detect memory/resource pressure where fewer workers may succeed."""
    if not stderr_text:
        return False
    lower = stderr_text.lower()
    markers = (
        "malloc",
        "cannot allocate memory",
        "not enough memory",
        "insufficient memory",
        "out of memory",
        "resource temporarily unavailable",
    )
    return any(m in lower for m in markers)


def remove_partial_output(output_path, input_path=None, logger=None):
    """Delete an incomplete output file after failed/cancelled processing."""
    if not output_path:
        return False
    try:
        if input_path and os.path.abspath(input_path) == os.path.abspath(output_path):
            return False
        if os.path.exists(output_path):
            os.remove(output_path)
            if logger:
                logger.info("Removed partial output: %s", output_path)
            return True
    except Exception as e:
        if logger:
            logger.warning("Could not remove partial output %s: %s", output_path, e)
    return False


def format_processing_error(raw_error, *, max_workers=None):
    """Map low-level FFmpeg/Python errors to user-facing Spanish messages."""
    raw = str(raw_error or "").strip()
    lower = raw.lower()
    if not raw:
        return "El procesamiento falló por un error desconocido."
    if lower == "cancelled" or lower == "canceled":
        return "Procesamiento cancelado."
    if is_resource_pressure_error(raw):
        workers = f" con {max_workers} videos en paralelo" if max_workers and max_workers > 1 else ""
        return (
            f"Memoria insuficiente durante la codificación{workers}. "
            "Beru reintentará con menos videos en paralelo; si persiste, usa Auto/Conservador "
            "o reduce los workers manuales."
        )
    if "timeout" in lower:
        return (
            "FFmpeg tardó demasiado y se canceló ese job. "
            "Prueba con menos videos en paralelo o con el perfil Rápido."
        )
    if "no space left" in lower:
        return "No hay espacio libre suficiente en el disco de salida."
    # Permission errors: "permission denied" (Linux/macOS), "access is denied"
    # (Windows), and "operation not permitted" (POSIX EPERM — e.g. file is open
    # in another process, or folder has restrictive ACLs). Previously
    # "operation not permitted" fell through to the hardware branch and users
    # got a misleading "update GPU drivers" message.
    if (
        "permission denied" in lower
        or "access is denied" in lower
        or "operation not permitted" in lower
    ):
        return (
            "No se pudo escribir el archivo de salida por permisos. "
            "Elige otra carpeta o cierra el video si está abierto en otro programa."
        )
    if "output would overwrite input" in lower:
        return "La salida intentaría sobrescribir el video original. Cambia la carpeta o el nombre de salida."
    if "ffmpeg not found" in lower:
        return "No se encontró FFmpeg. Reinstala Beru o verifica los binarios incluidos."
    if "ffprobe" in lower and ("not found" in lower or "no such file" in lower):
        return "No se encontró ffprobe para leer la información del video."
    if is_hardware_encode_error(raw):
        return (
            "El encoder de hardware falló. Beru intentará usar CPU; si persiste, cambia a modo "
            "Conservador o actualiza los drivers de video."
        )
    # Font / resource ENOENT: FFmpeg drawtext can't find the font file referenced
    # in the filter graph.  This typically means the font specified in the overlay
    # is not installed on this machine.
    if "enoent" in lower or "no such file" in lower:
        if "fontfile" in lower or "font" in lower or "drawtext" in lower:
            return (
                "No se encontró una fuente tipográfica necesaria para el texto. "
                "Instala la fuente indicada en el overlay o cambia a una fuente del sistema "
                "(Arial, Times New Roman, etc.) y vuelve a intentar."
            )
        return (
            "No se encontró un archivo necesario durante el procesamiento. "
            "Verifica que los archivos de entrada estén disponibles localmente "
            "(no en la nube) y vuelve a intentar."
        )
    return raw[-400:]
