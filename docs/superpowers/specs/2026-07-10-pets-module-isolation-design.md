# Pets Module Isolation — Design

**Date:** 2026-07-10  
**Status:** Approved (approach B)

## Problem

Pets (~29 files, ~2.5–2.7k LOC src+main) is an adjacent product living inside the batch video editor. Handlers and the overlay Vite entry are already separate, but the feature still couples into eager shell imports, boot-time `initPets()`, `uiSlice` palette state, `useKeyboard`, and global CSS.

## Goal

Treat pets as an isolated module: folder + IPC entry facade + aggressive lazy load. Observable behavior stays identical.

## Architecture

- `src/features/pets/` — components, hooks, utils, `pets.css`, barrel
- `main/pets/index.js` — `registerPetsModule()` / `disposePetsModule()`
- `petSlice` stays in `stores/slices/` (same Zustand pattern as auth/watermark)
- Overlay Vite entry paths unchanged

## Out of scope

Separate `usePetStore`, conditional preload, i18n file split.
