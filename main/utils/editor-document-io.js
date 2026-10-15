import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { EDIT_AUTOSAVE_TYPE, parseEditorProject } from "../../shared/editor-project.js";

export async function writeFileAtomic(file, text) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.promises.open(tmp, "wx");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmp, file);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true });
    throw error;
  }
}

async function readJson(file) {
  let raw;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "El archivo no es JSON válido" };
  }
}

export async function readEditorDocument(file) {
  const read = await readJson(file);
  if (read === null) return { ok: false, error: "Archivo no encontrado", missing: true };
  if (!read.ok) return read;
  return parseEditorProject(read.data);
}

export async function writeEditorDocument(file, project, { baseRevision } = {}) {
  const parsed = parseEditorProject(project);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const existing = await readEditorDocument(file);
  if (!existing.missing) {
    if (!existing.ok)
      return { ok: false, error: "El archivo existente no es un proyecto de edición" };
    if (baseRevision !== undefined && existing.project.revision !== baseRevision) {
      return { ok: false, conflict: true, error: "El proyecto cambió en disco desde que se abrió" };
    }
  }

  await writeFileAtomic(file, `${JSON.stringify(project, null, 2)}\n`);
  return { ok: true, revision: project.revision };
}

export async function writeAutosave(file, project) {
  const parsed = parseEditorProject(project);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const envelope = { type: EDIT_AUTOSAVE_TYPE, savedAt: new Date().toISOString(), project };
  await writeFileAtomic(file, JSON.stringify(envelope));
  return { ok: true };
}

export async function readAutosave(file) {
  const read = await readJson(file);
  if (read === null) return { ok: true, autosave: null };
  if (!read.ok) return read;
  if (read.data?.type !== EDIT_AUTOSAVE_TYPE) return { ok: false, error: "Autosave inválido" };
  const parsed = parseEditorProject(read.data.project);
  if (!parsed.ok) return parsed;
  return { ok: true, autosave: { savedAt: read.data.savedAt, project: parsed.project } };
}

export async function clearAutosave(file) {
  await fs.promises.rm(file, { force: true });
}

function assetStatusFromError(error) {
  if (error === "Archivo no encontrado") return "missing";
  if (error === "Archivo fuera de ubicaciones permitidas") return "authorization-required";
  return "invalid";
}

export function readKindFor(asset) {
  return asset.metadata?.durationUs == null ? "image" : "video";
}

export function inspectAssets(assets, pathSecurity) {
  return assets.map((asset) => {
    const check = pathSecurity.validateReadableFile(asset.path, readKindFor(asset));
    if (!check.ok)
      return { id: asset.id, status: assetStatusFromError(check.error), error: check.error };
    const changed = identityChanged(asset, fs.statSync(check.resolvedPath));
    return { id: asset.id, status: changed ? "changed" : "ready" };
  });
}

export function identityChanged(identity, stat) {
  return (
    (identity.sizeBytes !== null && stat.size !== identity.sizeBytes) ||
    (identity.mtimeMs !== null && Math.round(stat.mtimeMs) !== Math.round(identity.mtimeMs))
  );
}
