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
        # POSIX EPERM is a permission error, not GPU. See format_processing_error.
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
    # POSIX EPERM is permission (file locked / ACL), not GPU.
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
    if "fontconfig" in lower:
        return (
            "No se encontró una fuente tipográfica necesaria para el texto. "
            "Instala la fuente indicada en el overlay o cambia a una fuente del sistema "
            "(Arial, Times New Roman, etc.) y vuelve a intentar."
        )
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
    if "drawtext" in lower and (
        "forbidden" in lower or "control character" in lower or "invalid" in lower
    ):
        return (
            "El texto del overlay contiene caracteres que el procesador no admite. "
            "Revisa el texto (emojis y símbolos poco habituales pueden requerir otra fuente)."
        )
    if "forbidden characters" in lower and "font" in lower:
        return "El nombre de la fuente contiene caracteres no permitidos. Elige una fuente del selector."
    if any(
        m in lower
        for m in (
            "error when evaluating the expression",
            "invalid expression",
            "parse error",
            "syntax error",
        )
    ):
        return (
            "El filtro de una región no se pudo construir. "
            "Revisa que cada región tenga al menos 2 px y esté dentro del video."
        )
    if any(m in lower for m in ("invalid too big or non positive size", "non positive size")):
        return "El tamaño de una región no es válido. Ajusta la selección (mínimo 2 px de lado) y vuelve a intentar."
    if "input link parameters" in lower:
        return (
            "Los formatos de las capas no coinciden al superponer. "
            "Prueba con otra imagen o ajusta la región."
        )
    if any(
        m in lower
        for m in (
            "moov atom not found",
            "invalid data found when processing input",
            "could not find codec parameters",
        )
    ):
        return (
            "El archivo de entrada está dañado o incompleto (p. ej. descarga parcial o "
            "mp4 sin índice). Vuelve a exportarlo o usa otro archivo."
        )
    if any(
        m in lower
        for m in (
            "unknown encoder",
            "could not open codec",
            "error while opening encoder",
            "unsupported codec",
            "no decoder",
            "unsupported pixel format",
            "incompatible pixel format",
            "pixel format not supported",
        )
    ):
        return (
            "El códec o formato de píxeles del video no es compatible con la salida. "
            "Prueba con el perfil 'balanced' o cambia la extensión de salida."
        )
    if any(
        m in lower
        for m in (
            "too many packets buffered",
            "muxing queue",
            "unable to find a suitable output format",
            "output format not found",
        )
    ):
        return (
            "No se pudo empaquetar el video en el formato de salida. "
            "Prueba con .mp4 u otra extensión."
        )
    return raw[-400:]
