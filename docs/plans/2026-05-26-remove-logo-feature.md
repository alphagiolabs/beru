# Remove Logo Feature — Implementation Plan

**Goal:** Add a "Remover Logo" feature using FFmpeg's native `delogo` filter to remove logos/watermarks from videos.

**Architecture:** New `delogo` OperationMode in Rust backend generating `delogo=x=X:y=Y:w=W:h=H` filter chains. Frontend tool draws rectangular regions over logos. Multiple regions supported. FFmpeg interpolates surrounding pixels at native speed.

**Tech Stack:** Svelte 5, TypeScript, Tauri 2 (Rust), FFmpeg `delogo` filter
