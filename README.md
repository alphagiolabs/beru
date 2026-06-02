# Beru

Editor de video masivo con overlays de texto (modo lote + Excel), blur, recorte y remoción de logos.

## Desarrollo

```bash
npm install
npm run dev
```

```bash
npm test
```

## Archivos locales de prueba

No incluyas videos de prueba en el repositorio. `prueba.mp4` y `tmp/` están en `.gitignore`. Para comprobar que nunca se commitearon:

```bash
git log --all --full-history -- "prueba.mp4"
```

## Firma de código (Windows / SmartScreen)

Los releases en GitHub Actions se firman automáticamente si configuras estos secrets del repositorio:

| Secret | Descripción |
|--------|-------------|
| `WINDOWS_CERTIFICATE_BASE64` | Certificado `.p12` / `.pfx` en Base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Contraseña del certificado |

Sin esos secrets, el workflow publica un instalador **sin firmar** (`CSC_IDENTITY_AUTO_DISCOVERY=false`) y Windows SmartScreen mostrará advertencias la primera vez.

### Opciones recomendadas

1. **Azure Trusted Signing** (adecuado para proyectos OSS) — integrar el certificado en el secret `WINDOWS_CERTIFICATE_BASE64`.
2. **Certificado EV** de una CA comercial — menor fricción con SmartScreen tras reputación.

Flujo local de prueba con certificado:

```powershell
$env:CSC_LINK = "C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "your-password"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "true"
npm run build
```

## Seguridad IPC

El proceso principal valida rutas antes de leer archivos (`main/pathSecurity.js`):

- Extensiones permitidas por tipo (Excel, imagen, video, proyecto JSON).
- Tamaño máximo por archivo.
- Rutas bajo carpetas de usuario confiables o archivos elegidos explícitamente en diálogos nativos.
- Bloqueo de rutas sensibles del sistema (`System32`, `/etc/passwd`, etc.).

Los presets y proyectos importados sanitizan regiones de plantilla (`clampRegionToVideo`) para evitar valores corruptos.

## Rendimiento en lote

| Modo | Workers paralelos (típico) |
|------|----------------------------|
| Auto (balanceado) | Hasta **5** con NVENC/QSV; **1** con Media Foundation |
| Manual | 1–16 en el selector del header |
| Conservador | `batchWorkersMode: "conservative"` en `settings.json` (GPU max 2) |

Variables de entorno del procesador Python:

| Variable | Descripción |
|----------|-------------|
| `BERU_WORKERS` | `0` = auto; `>0` = fijo |
| `BERU_WORKERS_MODE` | `balanced` (default) o `conservative` |
| `BERU_RETRY_FAILED` | `1` = reintenta fallidos con la mitad de workers (default) |

Benchmark local (requiere clips en una carpeta):

```powershell
.\scripts\benchmark-batch.ps1 -InputDir "C:\ruta\clips" -Count 5 -Workers 5
```