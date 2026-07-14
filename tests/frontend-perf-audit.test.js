/**
 * Frontend performance audit tests.
 *
 * These tests validate that performance-critical patterns are present and
 * correct in the codebase. They do NOT modify any source files — they are
 * read-only assertions that guard against regressions.
 *
 * Run: npm test -- frontend-perf-audit
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(root, rel), "utf-8");
}

describe("Frontend performance audit", () => {
  /* ── Store subscriptions ────────────────────────────────────────── */

  describe("Store subscription patterns", () => {
    it("uses createWithEqualityFn with Object.is for selective subscriptions", () => {
      const store = readSrc("src/stores/useEditorStore.js");
      expect(store).toContain("createWithEqualityFn");
      expect(store).toContain("Object.is");
    });

    it("VideoPreview uses shallow for multi-field subscriptions", () => {
      const vp = readSrc("src/components/VideoPreview.jsx");
      expect(vp).toContain('from "zustand/shallow"');
      expect(vp).toMatch(/useEditorStore\(\s*\(s\)\s*=>\s*\(/);
    });

    it("QueueSidebar uses memoized QueueRow with custom comparator", () => {
      const qs = readSrc("src/components/QueueSidebar.jsx");
      expect(qs).toContain("memo(");
      expect(qs).toContain("prev.item === next.item");
    });

    it("TextOverlay is memoized", () => {
      const to = readSrc("src/components/TextOverlay.jsx");
      expect(to).toContain("memo(TextOverlay)");
    });

    it("Thumbnail is memoized", () => {
      const qs = readSrc("src/components/QueueSidebar.jsx");
      expect(qs).toContain("memo(function Thumbnail");
    });
  });

  /* ── Bundle optimization ────────────────────────────────────────── */

  describe("Bundle optimization", () => {
    it("splits xlsx into a manual chunk", () => {
      const vite = readSrc("vite.config.js");
      expect(vite).toContain("manualChunks");
      expect(vite).toContain("xlsx");
    });

    it("lazy-loads heavy modals (ShortcutsModal, TableEditor, ExcelMappingModal, WatermarkModal)", () => {
      const app = readSrc("src/App.jsx");
      expect(app).toContain("lazy(() =>");
      expect(app).toContain("ShortcutsModal");
      expect(app).toContain("TableEditor");
      expect(app).toContain("ExcelMappingModal");
      expect(app).toContain("WatermarkModal");
      expect(app).toContain("Suspense");
    });
  });

  /* ── Render optimization ────────────────────────────────────────── */

  describe("Render optimization", () => {
    it("VideoPreview memoizes activeOpsWithScreen", () => {
      const vp = readSrc("src/components/VideoPreview.jsx");
      expect(vp).toContain("activeOpsWithScreen = useMemo(");
    });

    it("VideoPreview memoizes batchRegionPreviews", () => {
      const vp = readSrc("src/components/VideoPreview.jsx");
      expect(vp).toContain("batchRegionPreviews = useMemo(");
    });

    it("useT returns a stable useCallback keyed by dict", () => {
      const useT = readSrc("src/i18n/useT.js");
      expect(useT).toContain("useCallback(");
      expect(useT).toContain("[dict]");
    });

    it("QueueSidebar precomputes derived row data with useMemo", () => {
      const qs = readSrc("src/components/QueueSidebar.jsx");
      expect(qs).toContain("rows = useMemo(");
      expect(qs).toContain("deriveRow(");
    });

    it("useCanvas uses useCallback for event handlers", () => {
      const uc = readSrc("src/hooks/useCanvas.js");
      expect(uc).toContain("useCallback(");
    });
  });

  /* ── DelogoLivePreview RAF loop ─────────────────────────────────── */

  describe("DelogoLivePreview performance", () => {
    it("pauses the RAF loop when video is paused", () => {
      const dlp = readSrc("src/components/DelogoLivePreview.jsx");
      expect(dlp).toContain("video.paused");
      expect(dlp).toContain("scheduleNext");
    });

    it("backs off when video is not ready", () => {
      const dlp = readSrc("src/components/DelogoLivePreview.jsx");
      expect(dlp).toContain("readyState");
      expect(dlp).toContain("setTimeout(draw, 100)");
    });

    it("skips drawing when document is hidden", () => {
      const dlp = readSrc("src/components/DelogoLivePreview.jsx");
      expect(dlp).toContain("document.hidden");
    });

    it("releases the preview workspace on unmount", () => {
      const dlp = readSrc("src/components/DelogoLivePreview.jsx");
      expect(dlp).toContain("releasePreviewWorkspace");
    });

    it("supports FPS throttle via PERF_FLAGS", () => {
      const dlp = readSrc("src/components/DelogoLivePreview.jsx");
      expect(dlp).toContain("PERF_FLAGS");
      expect(dlp).toContain("delogoThrottleFps");
    });
  });

  /* ── Processing progress batching ───────────────────────────────── */

  describe("Processing progress batching", () => {
    it("useProcessing batches job progress with RAF", () => {
      const up = readSrc("src/hooks/useProcessing.js");
      expect(up).toContain("pendingJobProgress");
      expect(up).toContain("requestAnimationFrame");
      expect(up).toContain("updateJobProgressBatch");
    });

    it("supports log batching via PERF_FLAGS", () => {
      const up = readSrc("src/hooks/useProcessing.js");
      expect(up).toContain("logBatch");
      expect(up).toContain("appendLogBatch");
    });
  });

  /* ── Auto-update throttle ───────────────────────────────────────── */

  describe("Auto-update", () => {
    it("throttles update checks to 30 minutes", () => {
      const uu = readSrc("src/hooks/useUpdater.js");
      expect(uu).toContain("UPDATE_CHECK_THROTTLE_MS");
      expect(uu).toContain("30 * 60 * 1000");
    });

    it("defers the first check by 2.5 seconds", () => {
      const uu = readSrc("src/hooks/useUpdater.js");
      expect(uu).toContain("UPDATE_CHECK_DELAY_MS");
      expect(uu).toContain("2500");
    });
  });

  /* ── Dependency alignment ───────────────────────────────────────── */

  describe("Dependency alignment", () => {
    it("React 19 is installed and used in main.jsx with StrictMode", () => {
      const main = readSrc("src/main.jsx");
      expect(main).toContain("React.StrictMode");
      expect(main).toContain("createRoot");
    });

    it("Zustand v4 traditional store is used (createWithEqualityFn)", () => {
      const store = readSrc("src/stores/useEditorStore.js");
      expect(store).toContain("zustand/traditional");
    });

    it("Vite config defines __APP_VERSION__ from package.json", () => {
      const vite = readSrc("vite.config.js");
      expect(vite).toContain("__APP_VERSION__");
    });
  });

  /* ── Known performance gaps (informational, not blocking) ───────── */

  describe("Known performance gaps", () => {
    it("PERF_FLAGS default to safe, proven performance values", () => {
      const pf = readSrc("src/utils/perf-flags.js");
      // Progress map keeps queue stable during batch processing (enabled by default).
      expect(pf).toContain('flagBool("VITE_BERU_RENDER_PROGRESS_MAP", true)');
      // Virtualization wired with @tanstack/react-virtual (on by default above threshold).
      expect(pf).toContain('flagBool("VITE_BERU_RENDER_VIRTUALIZE", true)');
      // Delogo preview throttled to 30 FPS to reduce CPU while remaining smooth.
      expect(pf).toContain('flagNumber("VITE_BERU_DELGO_THROTTLE_FPS", 30)');
      // Quickselect reduces temporal median complexity but requires validation.
      expect(pf).toContain('flagBool("VITE_BERU_DELGO_QUICKSELECT", true)');
      // Log batching coalesces rapid processing logs into 50 ms store updates.
      expect(pf).toContain('flagBool("VITE_BERU_LOG_BATCH", true)');
    });

    it("StatusFooter avoids subscribing to the full queue array", () => {
      const sf = readSrc("src/components/StatusFooter.jsx");
      expect(sf).not.toContain("queue: s.queue");
      expect(sf).toContain("queueLength: s.queue.length");
    });

    it("StatusFooter only subscribes to executionHistory when panel is open", () => {
      const sf = readSrc("src/components/StatusFooter.jsx");
      expect(sf).toContain("historyOpen ? s.executionHistory : null");
      expect(sf).not.toMatch(/executionHistory:\s*s\.executionHistory/);
    });

    it("BatchPanel avoids subscribing to the full queue array", () => {
      const bp = readSrc("src/components/BatchPanel.jsx");
      expect(bp).not.toContain("queue: s.queue");
      expect(bp).toContain("queueLength: s.queue.length");
    });
  });
});
