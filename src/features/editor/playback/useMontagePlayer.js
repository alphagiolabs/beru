import { useEffect, useRef, useState } from "react";
import {
  decideAdvance,
  entryAt,
  preloadTarget,
  projectUsAtSource,
  sourceSecondsAt,
} from "./scene.js";

function createMontageController(elements, latest, setActive, setStatus) {
  const state = {
    active: 0,
    clipId: [null, null],
    url: [null, null],
    pendingSeek: [null, null],
    seekStart: [null, null],
    ready: [false, false],
    pendingPlay: false,
  };

  const media = (slot) => elements[slot].current;
  const entryForClip = (clipId) => latest.current.layout.find((e) => e.clip.id === clipId) ?? null;

  function report(slot, next) {
    if (slot === state.active) setStatus(next);
  }

  function placeLayer(slot, entry) {
    const frame = latest.current.frames?.[slot]?.current;
    const layer = latest.current.layerFor?.(entry);
    const element = media(slot);
    if (!frame || !layer || !element) return;
    Object.assign(frame.style, {
      left: `${layer.frame.left}px`,
      top: `${layer.frame.top}px`,
      width: `${layer.frame.width}px`,
      height: `${layer.frame.height}px`,
    });
    Object.assign(element.style, {
      width: `${layer.source.width}px`,
      height: `${layer.source.height}px`,
      transform: `matrix(${layer.matrix.join(", ")})`,
    });
  }

  function applySeek(slot) {
    const element = media(slot);
    if (!element || state.pendingSeek[slot] === null) return;
    state.seekStart[slot] = performance.now();
    element.currentTime = state.pendingSeek[slot];
    state.pendingSeek[slot] = null;
  }

  function finishSeek(slot) {
    const started = state.seekStart[slot];
    state.seekStart[slot] = null;
    const entry = state.clipId[slot] ? entryForClip(state.clipId[slot]) : null;
    if (started !== null && entry)
      latest.current.onSeekTimed?.(entry.clip.assetId, performance.now() - started);
  }

  function markReady(slot) {
    const element = media(slot);
    if (!element || element.readyState < 2 || element.seeking || element.videoWidth === 0) return;
    state.ready[slot] = true;
    report(slot, "ready");
    if (state.pendingPlay && slot === state.active && latest.current.playing) {
      state.pendingPlay = false;
      void element.play().catch(() => {});
    }
  }

  function prepare(slot, entry, projectUs) {
    const element = media(slot);
    if (element) {
      element.playbackRate = entry.clip.speed;
      element.muted = entry.clip.muted === true;
    }
    placeLayer(slot, entry);
    const url = latest.current.sourceUrlFor(entry.clip.assetId);
    state.clipId[slot] = entry.clip.id;
    state.ready[slot] = false;
    if (!element) return;
    if (!url) {
      state.url[slot] = null;
      state.pendingSeek[slot] = null;
      element.removeAttribute("src");
      element.load();
      report(slot, "missing");
      return;
    }
    state.pendingSeek[slot] = sourceSecondsAt(entry, projectUs);
    if (state.url[slot] !== url) {
      state.url[slot] = url;
      element.src = url;
      report(slot, "loading");
    } else if (element.readyState >= 1) {
      applySeek(slot);
    }
  }

  function refreshSources() {
    for (const slot of [0, 1]) {
      const entry = state.clipId[slot] ? entryForClip(state.clipId[slot]) : null;
      if (!entry) continue;
      const url = latest.current.sourceUrlFor(entry.clip.assetId);
      if (url === state.url[slot]) continue;
      const projectUs = Math.min(Math.max(latest.current.playhead, entry.startUs), entry.endUs - 1);
      prepare(slot, entry, projectUs);
    }
  }

  function seekActiveTo(projectUs) {
    const entry = entryAt(latest.current.layout, projectUs);
    if (!entry) return null;
    const slot = state.active;
    if (state.clipId[slot] !== entry.clip.id) {
      prepare(slot, entry, projectUs);
    } else {
      const element = media(slot);
      state.pendingSeek[slot] = sourceSecondsAt(entry, projectUs);
      state.ready[slot] = false;
      if (element && element.readyState >= 1) applySeek(slot);
    }
    return entry;
  }

  function tryPlay() {
    const element = media(state.active);
    if (!element) return;
    if (state.ready[state.active]) void element.play().catch(() => {});
    else state.pendingPlay = true;
  }

  function pauseSlot(slot) {
    const element = media(slot);
    if (element && !element.paused) element.pause();
  }

  function handover(next) {
    const from = state.active;
    const to = 1 - from;
    pauseSlot(from);
    state.active = to;
    setActive(to);
    if (state.clipId[to] === next.clip.id && state.ready[to]) {
      void media(to)
        ?.play()
        .catch(() => {});
    } else {
      prepare(to, next, next.startUs);
      state.pendingPlay = true;
    }
  }

  function step() {
    const slot = state.active;
    const element = media(slot);
    const clipId = state.clipId[slot];
    const entry = entryForClip(clipId);
    if (!element || !entry || !state.ready[slot]) return;
    const { layout, onPlayhead, onPlayingChange } = latest.current;
    const projectUs = projectUsAtSource(entry, element.currentTime * 1_000_000);
    const decision = decideAdvance(layout, clipId, projectUs);
    if (decision.kind === "end") {
      pauseSlot(slot);
      onPlayhead(entry.endUs);
      onPlayingChange(false);
      return;
    }
    if (decision.kind === "advance") {
      handover(decision.entry);
      return;
    }
    onPlayhead(projectUs);
    const idle = 1 - slot;
    const target = preloadTarget(layout, clipId, projectUs, state.clipId[idle]);
    if (target) prepare(idle, target, target.startUs);
  }

  function attachListeners() {
    const cleanups = [];
    elements.forEach((ref, slot) => {
      const element = ref.current;
      if (!element) return;
      const on = (type, handler) => {
        element.addEventListener(type, handler);
        cleanups.push(() => element.removeEventListener(type, handler));
      };
      on("loadedmetadata", () => {
        if (element.videoWidth === 0) {
          state.ready[slot] = false;
          report(slot, "noVideo");
          return;
        }
        applySeek(slot);
      });
      on("loadeddata", () => markReady(slot));
      on("seeked", () => {
        finishSeek(slot);
        markReady(slot);
      });
      on("error", () => {
        state.ready[slot] = false;
        report(slot, "error");
      });
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }

  function refreshLayers() {
    for (const slot of [0, 1]) {
      const entry = state.clipId[slot] ? entryForClip(state.clipId[slot]) : null;
      if (entry) placeLayer(slot, entry);
    }
  }

  function setPlaying(playing) {
    if (!playing) {
      pauseSlot(0);
      pauseSlot(1);
      state.pendingPlay = false;
      return undefined;
    }
    const entry = seekActiveTo(latest.current.playhead);
    if (!entry) {
      latest.current.onPlayingChange(false);
      return undefined;
    }
    tryPlay();
    let frame = 0;
    const tick = () => {
      step();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }

  return { attachListeners, refreshSources, refreshLayers, seekActiveTo, setPlaying };
}

export function useMontagePlayer({
  layout,
  sourceUrlFor,
  layerFor,
  frames,
  playing,
  playhead,
  onPlayhead,
  onPlayingChange,
  onSeekTimed,
}) {
  const elements = [useRef(null), useRef(null)];
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("idle");
  const latest = useRef(null);
  const controller = useRef(null);
  if (controller.current === null) {
    controller.current = createMontageController(elements, latest, setActive, setStatus);
  }

  useEffect(() => {
    latest.current = {
      layout,
      sourceUrlFor,
      layerFor,
      frames,
      playing,
      playhead,
      onPlayhead,
      onPlayingChange,
      onSeekTimed,
    };
  });

  useEffect(() => controller.current.attachListeners(), []);

  useEffect(() => {
    controller.current.refreshSources();
  }, [sourceUrlFor]);

  useEffect(() => {
    controller.current.refreshLayers();
  }, [layout, layerFor]);

  useEffect(() => {
    if (!playing) controller.current.seekActiveTo(playhead);
  }, [playhead, layout, playing]);

  useEffect(() => {
    if (latest.current?.playing) latest.current.onPlayingChange(false);
  }, [layout]);

  useEffect(() => controller.current.setPlaying(playing), [playing]);

  return { refs: elements, active, status };
}
