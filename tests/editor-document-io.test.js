import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPathSecurity } from "../main/pathSecurity.js";
import {
  clearAutosave,
  inspectAssets,
  readAutosave,
  readEditorDocument,
  writeAutosave,
  writeEditorDocument,
} from "../main/utils/editor-document-io.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, insertClip, setCanvas } from "../shared/editor-timeline.js";

const SECOND = 1_000_000;

describe("editor document persistence", () => {
  let root;
  let trusted;
  let outside;
  let security;
  let docFile;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "beru-edit-io-"));
    trusted = path.join(root, "trusted");
    outside = path.join(root, "outside");
    fs.mkdirSync(path.join(trusted, "home", "Videos"), { recursive: true });
    fs.mkdirSync(path.join(trusted, "userdata"), { recursive: true });
    fs.mkdirSync(path.join(trusted, "temp"), { recursive: true });
    fs.mkdirSync(path.join(trusted, "app"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    const locations = {
      userData: path.join(trusted, "userdata"),
      temp: path.join(trusted, "temp"),
      home: path.join(trusted, "home"),
      documents: path.join(trusted, "home", "Documents"),
      downloads: path.join(trusted, "home", "Downloads"),
      desktop: path.join(trusted, "home", "Desktop"),
      videos: path.join(trusted, "home", "Videos"),
      music: path.join(trusted, "home", "Music"),
      pictures: path.join(trusted, "home", "Pictures"),
    };
    security = createPathSecurity({
      isPackaged: false,
      getPath: (name) => locations[name] ?? trusted,
      getAppPath: () => path.join(trusted, "app"),
    });
    docFile = path.join(trusted, "home", "Videos", "montaje.beru-edit.json");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const project = (overrides = {}) => ({
    ...createEmptyEditorProject({ name: "Montaje" }),
    ...overrides,
  });

  function projectWithFile(filePath, { durationSec = 8 } = {}) {
    fs.writeFileSync(filePath, Buffer.alloc(2048, 1));
    const stat = fs.statSync(filePath);
    const added = addAsset(createEmptyEditorProject(), {
      path: filePath,
      filename: path.basename(filePath),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      metadata: { durationUs: durationSec * SECOND },
    });
    return insertClip(added.project, { assetId: added.assetId, sourceOutUs: 3 * SECOND }).project;
  }

  describe("atomic save", () => {
    it("writes a readable document and leaves no temporary file", async () => {
      const result = await writeEditorDocument(docFile, project({ revision: 2 }));
      expect(result).toEqual({ ok: true, revision: 2 });
      expect(fs.readdirSync(path.dirname(docFile)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
      const loaded = await readEditorDocument(docFile);
      expect(loaded.ok && loaded.project.revision).toBe(2);
    });

    it("removes the temporary file when autosave rename fails and preserves the destination", async () => {
      const blocker = path.join(trusted, "home", "Videos", "blocker");
      fs.mkdirSync(blocker);
      fs.writeFileSync(path.join(blocker, "keep.txt"), "x");
      await expect(writeAutosave(blocker, project())).rejects.toThrow();
      expect(fs.readdirSync(path.dirname(blocker)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
      expect(fs.readdirSync(blocker)).toEqual(["keep.txt"]);
      expect(fs.readFileSync(path.join(blocker, "keep.txt"), "utf8")).toBe("x");
    });

    it("refuses to write an invalid document and does not touch the file", async () => {
      await writeEditorDocument(docFile, project({ name: "Original" }));
      const result = await writeEditorDocument(docFile, project({ version: 9 }));
      expect(result.ok).toBe(false);
      const loaded = await readEditorDocument(docFile);
      expect(loaded.ok && loaded.project.name).toBe("Original");
    });
  });

  describe("revision conflicts", () => {
    it("detects that the file changed since this session loaded it", async () => {
      await writeEditorDocument(docFile, project({ revision: 3 }));
      const other = await writeEditorDocument(docFile, project({ revision: 5 }), {
        baseRevision: 3,
      });
      expect(other.ok).toBe(true);
      const stale = await writeEditorDocument(docFile, project({ revision: 4 }), {
        baseRevision: 3,
      });
      expect(stale).toEqual({
        ok: false,
        conflict: true,
        error: "El proyecto cambió en disco desde que se abrió",
      });
    });

    it("replaces an existing editor file on Save As, without a base revision", async () => {
      await writeEditorDocument(docFile, project({ revision: 7 }));
      const result = await writeEditorDocument(docFile, project({ revision: 1 }));
      expect(result.ok).toBe(true);
    });

    it("never overwrites a file that is not an editor document", async () => {
      fs.writeFileSync(docFile, JSON.stringify({ type: "beru-project", version: "1.3.0" }));
      const result = await writeEditorDocument(docFile, project());
      expect(result.error).toMatch(/no es un proyecto de edición/);
      expect(JSON.parse(fs.readFileSync(docFile, "utf8")).type).toBe("beru-project");
    });
  });

  describe("open", () => {
    it("rejects an unsupported document version with a readable message", async () => {
      fs.writeFileSync(docFile, JSON.stringify({ ...project(), version: 2 }));
      const loaded = await readEditorDocument(docFile);
      expect(loaded.ok).toBe(false);
      expect(loaded.error).toMatch(/no soportada: 2/);
    });

    it("reports invalid JSON without throwing", async () => {
      fs.writeFileSync(docFile, "{ not json");
      expect(await readEditorDocument(docFile)).toEqual({
        ok: false,
        error: "El archivo no es JSON válido",
      });
    });

    it("reports a missing document as missing", async () => {
      expect(await readEditorDocument(docFile)).toMatchObject({ ok: false, missing: true });
    });
  });

  describe("asset status on open", () => {
    it("reports ready for a file inside a trusted root", () => {
      const media = path.join(trusted, "home", "Videos", "a.mp4");
      const doc = projectWithFile(media);
      expect(inspectAssets(doc.assets, security)).toEqual([
        { id: doc.assets[0].id, status: "ready" },
      ]);
    });

    it("reports missing for a file that was moved", () => {
      const media = path.join(trusted, "home", "Videos", "a.mp4");
      const doc = projectWithFile(media);
      fs.rmSync(media);
      expect(inspectAssets(doc.assets, security)[0].status).toBe("missing");
    });

    it("reports changed when size or modification time differ from the document", () => {
      const media = path.join(trusted, "home", "Videos", "a.mp4");
      const doc = projectWithFile(media);
      fs.appendFileSync(media, "more");
      expect(inspectAssets(doc.assets, security)[0].status).toBe("changed");
    });

    it("requires authorization for a file outside the trusted roots and does not grant it", () => {
      const media = path.join(outside, "far.mp4");
      const doc = projectWithFile(media);
      const [status] = inspectAssets(doc.assets, security);
      expect(status.status).toBe("authorization-required");
      expect(security.validateReadableFile(media, "video").ok).toBe(false);
    });

    it("grants read only after the user selects the file, which resolves the status", () => {
      const media = path.join(outside, "far.mp4");
      const doc = projectWithFile(media);
      expect(security.registerSelectedPath(media, "video").ok).toBe(true);
      expect(inspectAssets(doc.assets, security)[0].status).toBe("ready");
    });
  });

  describe("autosave", () => {
    const autosaveFile = () => path.join(trusted, "userdata", "editor-autosave.json");

    it("round-trips a document and reports none when absent", async () => {
      expect(await readAutosave(autosaveFile())).toEqual({ ok: true, autosave: null });
      const edited = setCanvas(project({ revision: 4 }), { width: 1080, height: 1920 });
      expect((await writeAutosave(autosaveFile(), edited)).ok).toBe(true);
      const recovered = await readAutosave(autosaveFile());
      expect(recovered.ok && recovered.autosave.project).toEqual(edited);
      expect(recovered.ok && typeof recovered.autosave.savedAt).toBe("string");
    });

    it("rejects an autosave that is not an editor envelope", async () => {
      fs.writeFileSync(autosaveFile(), JSON.stringify({ type: "beru-project" }));
      expect(await readAutosave(autosaveFile())).toEqual({ ok: false, error: "Autosave inválido" });
    });

    it("is cleared on demand", async () => {
      await writeAutosave(autosaveFile(), project());
      await clearAutosave(autosaveFile());
      expect(fs.existsSync(autosaveFile())).toBe(false);
    });
  });
});
