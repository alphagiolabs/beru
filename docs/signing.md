# Code Signing for Beru (Windows NSIS Installer)

The Windows installer produced by `electron-builder` is currently unsigned. Unsigned installers trigger Microsoft Defender SmartScreen warnings and the auto-updater cannot cryptographically verify downloaded payloads. This document describes how to configure code signing.

## Current state

`package.json` already contains the `win` block:

```json
"win": {
  "icon": "brand/icon.ico",
  "artifactName": "Beru-Setup-${version}.${ext}",
  "target": [
    { "target": "nsis", "arch": ["x64"] }
  ],
  "signtoolOptions": {
    "publisherName": "Beru"
  }
}
```

`publisherName` is only a display string. It does not provide cryptographic identity.

## What to add

Once you have a valid code-signing certificate, extend the `signtoolOptions` block in `package.json` with one of the following approaches.

### Option A — Subject name (certificate installed in Windows store)

```json
"signtoolOptions": {
  "publisherName": "Beru",
  "certificateSubjectName": "CN=Beru, O=Alphagio Labs, L=...",
  "signingHashAlgorithms": ["sha256"],
  "rfc3161TimeStampServer": "http://timestamp.digicert.com"
}
```

### Option B — PFX file + password via environment

```json
"signtoolOptions": {
  "publisherName": "Beru",
  "signingHashAlgorithms": ["sha256"],
  "rfc3161TimeStampServer": "http://timestamp.digicert.com"
}
```

Build with:

```powershell
$env:CSC_LINK="C:\path\to\beru.pfx"
$env:CSC_KEY_PASSWORD="super-secret"
npm run build
```

`electron-builder` reads `CSC_LINK` and `CSC_KEY_PASSWORD` automatically.

## Recommended certificate types

1. **EV (Extended Validation) code-signing certificate** — best option for SmartScreen reputation. Once signed for a few weeks, SmartScreen warnings typically disappear.
2. **OV (Organization Validation) code-signing certificate** — cheaper than EV, requires the same build-time steps but SmartScreen reputation builds slower.
3. **Azure Trusted Signing** — Microsoft-hosted alternative, useful if you already use Azure. Configure via `electron-builder` `azureSignOptions` instead of `signtoolOptions`.

## CI / GitHub Actions

Store the certificate and password as GitHub secrets (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) and pass them to the build step:

```yaml
env:
  CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

## Verification

After signing, the installer will show `Publisher: Beru` in the UAC prompt instead of `Publisher: Unknown`. You can verify with:

```powershell
Get-AuthenticodeSignature -FilePath "dist-installer\Beru-Setup-1.6.24.exe"
```

## Important

Do not commit the PFX file or password to the repository. Use environment variables or a secure secrets manager.
