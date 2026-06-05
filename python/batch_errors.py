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
        "operation not permitted",
        "error while filtering",
        "no capable devices",
        "cannot create cuda",
        "out of memory",
        "encoder init",
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
    if "permission denied" in lower or "access is denied" in lower:
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
    return raw[-400:]
