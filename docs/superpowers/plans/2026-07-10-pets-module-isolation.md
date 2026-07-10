# Pets Module Isolation Implementation Plan

> **For agentic workers:** Use this plan as the checklist for the encapsulation work.

**Goal:** Encapsulate pets behind `src/features/pets` + `main/pets` with lazy load and deferred init.

**Status:** Implemented on `feat/pets-module-isolation`

## Tasks

- [x] Main IPC facade (`main/pets/index.js`)
- [x] Move renderer pets into `src/features/pets`
- [x] Lazy load + deferred `ensurePetsReady` + `usePetKeyboard`
- [x] Move `showPetPalette` into `petSlice`
- [x] Extract pet CSS + delete `PetCompanionSection`
- [x] Update tests import paths
