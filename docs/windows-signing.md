# Firma de Windows

El empaquetado usa `scripts/electron-builder.config.cjs` a través de
`npm run build`. `BERU_SIGNING_MODE` admite `unsigned` y `signed`.
Si no se indica, la presencia de `CSC_LINK` o `WIN_CSC_LINK` selecciona
`signed`; sin certificado se selecciona `unsigned`.

- `unsigned` conserva la distribución actual sin firma. Rechaza un certificado
  configurado y no escribe `publisherName` para el updater.
- `signed` requiere certificado, activa `forceCodeSigning` y
  `verifyUpdateCodeSignature`. Electron-builder escribe el publisher del
  certificado en `app-update.yml`; electron-updater usa su verificador nativo
  para rechazar actualizaciones con firmas inválidas o de otro publisher.

CI selecciona `signed` cuando existe `WINDOWS_CERTIFICATE_BASE64` y pasa
`WINDOWS_CERTIFICATE_PASSWORD` como contraseña del certificado. Empaqueta con
`--publish never`, ejecuta `scripts/verify-installer-signature.ps1` y publica
solo después de comprobar el instalador. El modo firmado exige Authenticode
`Valid`; el modo unsigned exige `NotSigned`. Los errores detienen el job.

Para comprobar un artefacto local sin publicar:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-installer-signature.ps1 -Mode unsigned
```

La protección de firma corresponde a las versiones instaladas con configuración
firmada. Una instalación unsigned previa sigue su propia política hasta que se
instale una versión firmada; configurar secretos no modifica aplicaciones ya
instaladas.

Referencias: [firma de Windows](https://www.electron.build/docs/features/code-signing/code-signing-win/)
y [configuración de Windows](https://www.electron.build/docs/win/).
