# Beru

Editor de video por lotes con overlays de texto desde Excel, desenfoque, recorte y eliminación de logotipos.

## Instalación

```bash
npm install
```

## Uso

```bash
npm run dev
```

## Pruebas

```bash
npm test
```

## Compilación

```bash
npm run build
```

El instalador se genera en `dist-installer/`.

## Firma de código (Windows)

Para firmar el instalador en GitHub Actions, configura los siguientes secrets:

- `WINDOWS_CERTIFICATE_BASE64`: Certificado `.p12`/`.pfx` en Base64
- `WINDOWS_CERTIFICATE_PASSWORD`: Contraseña del certificado

## Licencia

Este proyecto está bajo licencia MIT.
