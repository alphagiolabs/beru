import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function processorBuildFingerprint(files, toolchain) {
  return createHash("sha256")
    .update(JSON.stringify({ toolchain, sources: files.map(hashFile) }))
    .digest("hex");
}

export function isProcessorCurrent(executable, receiptPath, fingerprint) {
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    return receipt.fingerprint === fingerprint && receipt.sha256 === hashFile(executable);
  } catch {
    return false;
  }
}

export function writeProcessorReceipt(executable, receiptPath, fingerprint, toolchain) {
  writeFileSync(
    receiptPath,
    JSON.stringify({ fingerprint, sha256: hashFile(executable), toolchain }, null, 2) + "\n",
  );
}
