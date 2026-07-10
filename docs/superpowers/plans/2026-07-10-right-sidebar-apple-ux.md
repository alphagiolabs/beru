# Plan: Sidebar derecho (Inspector) — estética Apple, sin cambiar funcionalidad

**Fecha:** 2026-07-10  
**Branch base sugerida:** `fix/medios-ux-wave1` o rama dedicada `fix/inspector-sidebar-ux`  
**Skill de diseño:** `.agents/skills/apple-design`  
**Alcance visual:** `aside` derecho en `App.jsx` → `PropertiesPanel` + `StyleEditor` + `TextLayoutControls` (+ coherencia con `PresetManager`, `AppliedTextEditor`, `BatchPanel`, `LayerList`)  
**Fuera de alcance:** lógica de store, export FFmpeg, Excel mapping, canvas/preview, cambiar anchos de layout del centro o cola izquierda (salvo micro-ajuste opcional del inspector)

---

## 1. Objetivo

Hacer el panel de propiedades **más legible, jerárquico e intuitivo**, con sensación de inspector macOS / Settings (agrupación, materiales, feedback instantáneo, controles familiares), **sin alterar comportamiento**:

- Mismos modos (`logo` / `batch`), herramientas, setters y paths de `patch`.
- Mismos valores, defaults, validaciones y atajos.
- Mismos textos de dominio (i18n donde aplique; no inventar flujos nuevos).
- Tests existentes deben seguir pasando (selectores por rol, `data-text-style-preset`, labels, etc.).

**Éxito medible:**

1. El usuario localiza en &lt; 3 s: modo, región, tipografía, composición, color.
2. Controles activos se leen al primer vistazo (un solo idioma de “selected”).
3. Scroll del panel se siente calmado: grupos claros, no una lista plana de 9 px.
4. Zero regresión funcional en Vitest + smoke manual de aplicar texto / batch / delogo.

---

## 2. Diagnóstico (screenshot + código)

### 2.1 Estructura actual

| Pieza        | Archivo                     | Rol                                                                                             |
| ------------ | --------------------------- | ----------------------------------------------------------------------------------------------- |
| Contenedor   | `App.jsx` `aside.w-[280px]` | Scroll + fondo `bg-surface`                                                                     |
| Panel        | `PropertiesPanel.jsx`       | Tabs modo, región X/Y/W/H, tool-specific, CTA aplicar                                           |
| Estilo texto | `StyleEditor.jsx`           | Preview FFmpeg, presets, fuente, peso, tamaño, align, color, bold/italic, fondo, stroke, sombra |
| Composición  | `TextLayoutControls.jsx`    | autoFit, lineHeight, safeMargin, verticalAlign, wrap, truncate                                  |
| Primitivos   | `index.css` `.cap-*`        | Botones, inputs, labels, secciones                                                              |

### 2.2 Problemas de UX / craft (mapeados a Apple Design)

| #   | Observación                                                                                                             | Principio Apple violado                                                | Impacto                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| P1  | Todo al mismo “volumen”: labels 9–10px uppercase, bordes 1px duros, sin grupos inset                                    | **Simplicity + Craft** — jerarquía por contraste/spacing, no por ruido | Escaneo lento                                         |
| P2  | Segmented “Quitar logo / Texto en lote”: fill sólido distinto (accent vs púrpura hardcode `#a855f7`)                    | **Familiarity + Consistency**                                          | Dos idiomas de color; el púrpura hardcode rompe temas |
| P3  | Estados “activo” inconsistentes: blanco relleno (align), accent, rose (delogo), ring doble (presets)                    | **Familiarity** — “lo que se ve igual se comporta igual”               | El usuario no confía en qué está seleccionado         |
| P4  | Checkboxes nativos en auto-fit / wrap / fondo / sombra                                                                  | **Familiarity** (macOS usa switch) + hit target débil                  | Se siente web-form, no app                            |
| P5  | Orden mental irregular: preview → presets → fuente → peso → tamaño → align → composición → color → bold/italic → fondo… | **Purpose + Grouping** — mapping y proximity                           | Color/énfasis lejos de tipografía                     |
| P6  | CTA “Previsualizar frame” es secundaria y compite con el info-card batch                                                | **Purpose** — una acción primaria por contexto                         | Preview se pierde                                     |
| P7  | Grid 7 columnas de “Aa” (presets y pesos) en 280px: targets &lt; 36px, poco aire                                        | **Flexibility + Response**                                             | Mis-taps; feedback pobre                              |
| P8  | Separadores `border-t` / `border-b` duros en todo el panel                                                              | **Materials** — preferir grupos y scroll-edge, no rejilla de líneas    | Aspecto “formulario denso”                            |
| P9  | Tipografía: casi todo `tracking-widest uppercase` al mismo tamaño                                                       | **Typography** — tracking por tamaño; hierarchy weight+size+leading    | No hay “dónde estoy”                                  |
| P10 | Feedback solo de color; presets no usan `active:scale` de `.cap-btn`                                                    | **Response** — highlight on press                                      | Se siente muerto al click                             |
| P11 | Info batch con púrpura hardcode `rgba(168,85,247,…)`                                                                    | Tokens / temas                                                         | Roto en light o themes custom                         |
| P12 | Panel opaco + scrollbar nativa sin fade de borde sticky                                                                 | **Materials & depth**                                                  | Header de tabs se va con el scroll                    |

### 2.3 Qué NO está roto (preservar)

- Contrato de store: `setSidebarMode`, `updateRegionValue`, `patch` / `patchBatchTextStyle`, `addOperation`, `addTemplateRegion`, etc.
- `data-text-style-preset` / `data-preset-id` en presets (tests).
- Lógica condicional por `activeTool` + `sidebarMode`.
- Ancho 280px es constraint de producto — **el plan se adapta a 280px** (opcional 300px solo si se aprueba en implementación).

---

## 3. Enfoques (2–3) y recomendación

### A — Solo polish CSS (mínimo)

- Unificar tokens, segmented control, switches CSS, spacing, focus rings.
- **No** reordenar secciones ni collapsibles.
- **Pros:** riesgo bajo, diff chico. **Contras:** la densidad y el orden mental siguen; mejora estética limitada.

### B — Inspector agrupado (recomendado)

- Agrupar controles en **tarjetas inset** estilo Settings (Región | Tipografía | Composición | Apariencia | Efectos).
- Unificar **SegmentedControl** y **Toggle** reutilizables.
- Reordenar solo dentro de StyleEditor (sin quitar controles).
- Sticky chrome: tabs de modo + título de región.
- Collapsibles suaves en secciones secundarias (Efectos: fondo/borde/sombra).
- **Pros:** gran salto de claridad sin tocar lógica. **Contras:** más archivos; hay que cuidar tests de layout.

### C — Rediseño amplio (no recomendado ahora)

- Tabs internos “Estilo / Layout / Avanzado”, resizable panel, virtualización.
- **Pros:** escalable a futuro. **Contras:** scope creep; toca más UX de aprendizaje; fuera de “no afectar funcionalidad” percibida.

**Recomendación: B**, implementado en olas (Wave 1 visual system → Wave 2 structure → Wave 3 motion/a11y).

---

## 4. Principios de diseño a aplicar (traducción concreta)

Extraídos de `apple-design` y anclados a este panel:

1. **Response** — `:active` scale 0.97 en chips/segmentos; focus ring visible en inputs; highlight on pointer-down (CSS `active` basta; no hace falta gesture library).
2. **Familiarity** — segmented control tipo iOS; switches; botones de alineación como _segmented toolbar_; un solo patrón de selected.
3. **Simplicity (no minimalism)** — progressive disclosure: lo frecuente arriba (fuente, tamaño, color); lo avanzado (sombra, stroke, padding) colapsable **abierto por defecto si ya tiene valor activo**.
4. **Materials** — fondo del aside ligeramente distinto; grupos `bg-elevated` con radio 10–12px y padding 10–12; **evitar** apilar glass translúcido sobre glass; en dark opaco limpio + blur solo en sticky header opcional.
5. **Typography** — Section title: 11–12px semibold, tracking normal o leve negativo, color `text-secondary`. Field label: 10–11px medium, **sin** uppercase forzado en todo. Valores mono solo en numéricos.
6. **Spatial consistency** — Enter/exit de collapsibles con height+opacity; reduced-motion → cross-fade 150–200ms.
7. **Grouping & mapping** — Color junto a opacidad y bold/italic; composición junta; región (X/Y/W/H) arriba del estilo.
8. **Craft** — Un sistema de radio, gap y selected state documentado; cero hex hardcode de púrpura: usar `var(--purple)`.

### Lenguaje visual unificado (selected state)

| Control                       | Idle                                          | Selected / On                                                                                                                 |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Segmented mode                | `text-dim` / transparent                      | Fill `var(--accent)` o `var(--purple)` según modo, texto contrastante                                                         |
| Chips preset / weight / align | `bg-elevated` + border sutil                  | Fill accent (o soft fill `color-mix`) + border accent; **no** blanco plano salvo que el theme light lo requiera por contraste |
| Toggle                        | track dim                                     | track accent + thumb                                                                                                          |
| Primary CTA                   | gradient brand (ya existe `.cap-btn-primary`) | —                                                                                                                             |
| Danger / delogo               | rose solo en dominio “remover logo”           | mantener semántica rose **solo** ahí                                                                                          |

---

## 5. Arquitectura de UI propuesta (solo presentación)

```
aside.inspector (sticky header zone + scroll body)
├── InspectorModeSwitch          [Quitar logo | Texto en lote]
├── InspectorRegionHeader        [Región · filename]
├── InspectorGroup "Región"      [X Y W H + hint batch]
├── (tool blocks existentes: image / blur / delogo — mismos handlers)
├── InspectorGroup "Vista previa"[Previsualizar frame — solo text/batch]
├── InspectorGroup "Tipografía"  [presets, fuente, peso, tamaño, spacing, bold/italic]
├── InspectorGroup "Párrafo"     [align H, TextLayoutControls]
├── InspectorGroup "Color"       [color + opacidad]
├── InspectorGroup "Fondo"       [toggle + campos]     collapsible
├── InspectorGroup "Contorno"    [stroke]              collapsible
├── InspectorGroup "Sombra"      [toggle + campos]     collapsible
├── InspectorActions             [Aplicar / Agregar región | Cancelar]
├── Posición automática          [chips]
├── AppliedTextEditor / BatchPanel / LayerList (sin cambio de contrato)
```

**Regla dura:** cada control mantiene el mismo `onChange` / `patch({...})` actual. Solo se mueve markup y clases.

### Componentes reutilizables nuevos (presentacionales)

| Componente                        | Responsabilidad                         | No hace                                    |
| --------------------------------- | --------------------------------------- | ------------------------------------------ |
| `InspectorGroup`                  | Título + children + opcional collapse   | No lee store                               |
| `SegmentedControl`                | Lista de opciones, selectedId, onChange | No conoce sidebarMode internamente (props) |
| `ToggleSwitch`                    | checked + onChange + label              | Reemplaza checkbox nativo solo visual      |
| `ChipToggle` / `SegmentedToolbar` | grids de align, weight, presets         | Mismo click handlers                       |

Ubicación sugerida: `src/components/inspector/` para no inflar `PropertiesPanel.jsx`.

### Tokens / CSS

Añadir en `index.css` (o bajo prefijo `.inspector-*`):

- `.inspector-group` — padding, radius, gap, background elevated
- `.inspector-segmented` — track + item + item-active
- `.inspector-switch` — track/thumb con transition 150–200ms ease-out
- `.inspector-sticky-chrome` — sticky top, bg surface (opcional `backdrop-filter` solo si contraste OK en themes)
- Respetar `@media (prefers-reduced-motion: reduce)` y, si existe en el futuro, reduced transparency

**No** añadir tokens de tema nuevos salvo que un color no mapee; preferir `--purple`, `--accent`, `--bg-elevated`, `--border`.

---

## 6. Cambios por archivo (checklist de implementación)

### Wave 1 — Sistema visual (bajo riesgo)

1. **`src/index.css`**
   - Clases inspector (group, segmented, switch, chip-active).
   - Ajustar `.cap-input` / `.cap-input-label` **solo dentro de** `.inspector` o `.cap-section.inspector` para no romper Settings/modales.
2. **`src/App.jsx`**
   - Clase `inspector` en el `aside` (scroll containment).
   - Opcional: sticky no; el sticky vive dentro del panel.
3. **`PropertiesPanel.jsx`**
   - Reemplazar tabs modo por `SegmentedControl` con tokens (`var(--purple)` en batch, no `#a855f7`).
   - Info batch: tokens purple.
   - Envolver X/Y/W/H en `InspectorGroup`.
   - Unificar botones de apply/cancel spacing.
4. **Tests smoke:** `properties-panel-reactivity`, `delogo-cover-ui`, `app-render` — sin cambios de aserción si el texto de botones se mantiene.

### Wave 2 — StyleEditor / TextLayout (medio)

5. **`StyleEditor.jsx`**
   - Reordenar bloques a: Preview → Presets → Tipografía (fuente, peso, tamaño, spacing, B/I) → Align → Layout → Color/Opacity → Fondo → Stroke → Sombra.
   - Usar `InspectorGroup` + collapsibles en Fondo/Stroke/Sombra.
   - **Regla collapse:** si `bgEnabled` / `textShadowEnabled` / `borderWidth > 0`, sección inicia expandida.
   - Presets: gap 6px, min-height 32px, selected = soft accent (no doble box-shadow ruidoso).
   - Weight/align: `SegmentedToolbar` con un solo estilo selected.
6. **`TextLayoutControls.jsx`**
   - Switches para auto-fit y wrap.
   - Misma tipografía de labels que el resto.
7. **`PresetManager.jsx` / `AppliedTextEditor.jsx`**
   - Solo alinear spacing/labels si se ven desfasados; no reescribir lógica.

### Wave 3 — Motion, a11y, pulido (bajo riesgo residual)

8. Transiciones:
   - Segmented thumb o background: 180–220ms ease-out (critically damped feel; sin bounce en UI de formulario).
   - Collapse: `grid-template-rows` 0fr→1fr o max-height suave; reduced-motion → instant/opacity.
9. A11y:
   - `role="tablist"` / `aria-selected` en mode switch **o** `radiogroup` (elegir uno y documentarlo).
   - Switches: `role="switch"` + `aria-checked`.
   - Focus visible en todos los chips (`:focus-visible`).
10. Scroll:
    - Sticky mode+region header con borde inferior sutil o fade (no hard double border).
11. i18n:
    - Strings hardcode actuales en PropertiesPanel/StyleEditor: **no bloquear** la ola UX; ticket aparte si se quiere i18n completo. No introducir emojis.

### Explicit non-goals

- No cambiar anchos del preview ni QueueSidebar.
- No unificar delogo rose con accent (semántica distinta).
- No añadir librería de motion (Motion/Framer) en esta fase: CSS transitions bastan.
- No cambiar defaults de texto ni algoritmos de auto-fit.
- No rediseñar `BatchPanel` / `LayerList` en profundidad (solo coherencia de padding si se ve roto).

---

## 7. Detalle de interacción (por control clave)

### 7.1 Mode switch

- Dos segmentos full-width.
- Click → `setSidebarMode` (igual).
- Selected: fill sólido token; unselected: transparent sobre track `bg-elevated`.
- Press: `scale(0.98)` en el segmento o en el track.

### 7.2 Región X/Y/W/H

- Grid 2×2 dentro de group “Región”.
- Labels cortos `X` `Y` `W` `H` (ya legibles); inputs mono.
- Mantener conversión normalizada actual.

### 7.3 Presets de estilo

- Grid responsive: `grid-cols-7` se mantiene o baja a 5+wrap si el hit target &lt; 28px; preferir **mantener 7** con gap menor y padding interno.
- Selected: border accent + fondo `color-mix(in srgb, var(--accent) 18%, var(--bg-elevated))`.
- `title` y `aria-label` se mantienen.

### 7.4 Toggles (auto-fit, wrap, bg, shadow)

- Visual switch; misma semántica booleana.
- No usar checkbox nativo visible (puede quedar input sr-only o button role=switch).

### 7.5 Primary actions

- “Aplicar …” / “Agregar región de texto” permanecen full-width `.cap-btn-primary`.
- “Cancelar selección” como text button secondary debajo (ya existe).
- Ideal: actions **no sticky** en v1 (evita tapar controles en 280px); reevaluar en QA.

### 7.6 Preview frame

- Dentro de group “Vista previa”, botón secondary full-width con icono.
- Helper text 11px `text-dim` (subir de 9px si cabe) — legibilidad &gt; densidad extrema.

---

## 8. Orden de trabajo (tareas atómicas)

| ID  | Tarea                                                  | Archivos                     | Criterio de hecho                                                  |
| --- | ------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------ |
| T1  | Añadir clases CSS inspector + reduced-motion           | `index.css`                  | Visual en Story/manual sin regresión global de `.cap-*` en modales |
| T2  | `SegmentedControl` + `ToggleSwitch` + `InspectorGroup` | `src/components/inspector/*` | Unit visual; props-only                                            |
| T3  | Wire mode tabs + batch info card a tokens              | `PropertiesPanel.jsx`        | Mode switch funciona; no hex hardcode                              |
| T4  | Group región + spacing CTA                             | `PropertiesPanel.jsx`        | X/Y/W/H y apply intactos                                           |
| T5  | Refactor visual StyleEditor (orden + groups)           | `StyleEditor.jsx`            | Todos los `patch` keys iguales; presets tests green                |
| T6  | TextLayoutControls switches + labels                   | `TextLayoutControls.jsx`     | autoFit/wrap/truncate equal                                        |
| T7  | Collapsibles fondo/stroke/sombra                       | `StyleEditor.jsx`            | Expand auto si valor activo                                        |
| T8  | Sticky chrome + focus rings                            | panel CSS                    | Tabs visibles al scroll                                            |
| T9  | A11y attributes                                        | inspector comps              | Keyboard tab + Space en switches                                   |
| T10 | Quality gate                                           | —                            | lint, format, test                                                 |

**Orden de merge sugerido:** T1–T4 (PR1 polish shell) → T5–T7 (PR2 style body) → T8–T10 (PR3 a11y/motion).  
Alternativa single-PR si el equipo prefiere una sola review.

---

## 9. Riesgos y mitigación

| Riesgo                                 | Mitigación                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Tests buscan checkbox / estructura DOM | Preferir roles accesibles; actualizar tests solo si el selector era frágil |
| Themes light: accent fill + texto      | Verificar contraste en `beru-light` y `beru-dark`                          |
| Collapse oculta controles “activos”    | Auto-expand cuando el feature está on o tiene valor ≠ default              |
| Diff grande en StyleEditor             | Extraer subcomponentes presentacionales sin mover lógica `patch`           |
| 280px overflow horizontal              | `min-w-0`, no grids de 7 con padding excesivo; truncar labels largos       |
| Hardcode purple en tests de snapshot   | No hay snapshots de CSS esperados; grepear `#a855f7` y limpiar             |

---

## 10. Plan de verificación

### Automatizado (obligatorio al cerrar)

```bash
npm run lint
npm run format:check
npm test
```

Enfocados:  
`style-editor-presets`, `properties-panel-reactivity`, `delogo-cover-ui`, `app-render`, `batch-text-2mp4-parity`, `text-region-interaction`.

### Manual (checklist)

1. **Logo mode:** blur / delogo / image / text — aplicar operación; valores se reflejan en preview.
2. **Batch mode:** tabs, info card, región, estilo, “Agregar región”, Excel path no roto.
3. **Presets:** click cada preset; selected ring correcto; store style cambia.
4. **Toggles:** auto-fit, wrap, fondo, sombra — on/off y campos dependientes.
5. **Collapsibles:** con sombra on, sección visible tras remount (si se persiste estado visual solo en sesión, documentar).
6. **Tema claro/oscuro:** legibilidad de segmented y chips.
7. **Reduced motion** (OS): sin slides largos; switches aún se entienden.
8. **Teclado:** Tab por controles; Space/Enter en switches y segments.

### Criterio “no afecta funcionalidad”

- Diff de store slices = 0 (ideal).
- Diff de `python/` = 0.
- Cualquier cambio en tests solo por selectores de presentación, no por expectativas de valor.

---

## 11. Criterios de aceptación (Definition of Done)

- [ ] Mode switch usa tokens; sin `#a855f7` en el panel.
- [ ] Un solo patrón visual de “selected” en chips de estilo/align/weight.
- [ ] Controles agrupados en tarjetas con títulos legibles (no solo uppercase 10px).
- [ ] Checkboxes de composición/fondo/sombra son switches accesibles.
- [ ] Orden de StyleEditor: tipografía y color antes que efectos avanzados.
- [ ] Collapsibles no esconden estado activo al abrir el panel.
- [ ] Mismos handlers y resultados de apply/batch.
- [ ] Lint + format + tests verdes.
- [ ] Screenshots before/after en la PR (modo batch + logo text + delogo).

---

## 12. Estimación orientativa

| Ola                            | Esfuerzo      |
| ------------------------------ | ------------- |
| Wave 1 (shell + tokens + mode) | 0.5–1 d       |
| Wave 2 (StyleEditor + layout)  | 1–1.5 d       |
| Wave 3 (sticky, a11y, QA)      | 0.5 d         |
| **Total**                      | **~2–3 días** |

---

## 13. Referencia rápida de principios usados

- Response / press feedback
- Familiarity (segmented, switches, inspector groups)
- Simplicity via hierarchy + progressive disclosure
- Materials: elevated groups, no stacked glass
- Typography: size-specific tracking, weight hierarchy
- Spatial consistency + reduced motion
- Craft: tokens, un selected language, no hardcode

---

## 14. Siguiente paso

1. **Aprobar este plan** (o pedir ajustes de scope: ¿collapsibles sí/no? ¿ancho 280→300?).
2. Abrir rama `fix/inspector-sidebar-ux`.
3. Ejecutar T1→T10; PR con before/after.
4. No implementar hasta aprobación explícita si se sigue el flujo brainstorming del repo.
