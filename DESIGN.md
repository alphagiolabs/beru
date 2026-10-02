# DESIGN — Beru

Guía del sistema visual del renderer (`src/`). Antes de crear o rediseñar UI, leer esta guía y reutilizar lo que ya existe. Si algo no está aquí, buscar el patrón más cercano en el código antes de inventar uno nuevo, y añadirlo a esta guía cuando se consolide.

## Principios

1. **Herramienta, no escaparate.** La UI enmarca el video. Superficies oscuras y neutras, poco color, sin decoración.
2. **Un nivel de contenedor.** Evitar tarjetas dentro de tarjetas. Agrupar con espacio, divisores finos o un único contenedor.
3. **Jerarquía por tipografía y peso**, no por bordes o colores extra.
4. **Una acción primaria por superficie.** El resto usa variantes `secondary` o `tertiary`.
5. **Texto de ayuda en tooltips**, no en etiquetas largas visibles.
6. **Sin emojis** en UI, código ni documentación.

## Tokens

Definidos en `:root` y `[data-theme="light"]` de `src/index.css`. No usar hex sueltos en componentes; derivar variantes con `color-mix()` sobre estos tokens.

| Token                                           | Uso                                                  |
| ----------------------------------------------- | ---------------------------------------------------- |
| `--bg-app`                                      | Fondo base de la app y del canvas                    |
| `--bg-surface`                                  | Paneles laterales                                    |
| `--bg-elevated`                                 | Header, grupos, menús, tooltips                      |
| `--text-primary`                                | Texto principal y valores                            |
| `--text-secondary`                              | Etiquetas, botones secundarios, descripciones        |
| `--text-dim`                                    | Metadatos, placeholders, iconos inactivos            |
| `--border`                                      | Bordes y divisores (suavizar con `color-mix` al 80%) |
| `--accent-brand`                                | Acción primaria, foco, estado seleccionado           |
| `--rose`                                        | Destructivo y herramienta "Quitar logo"              |
| `--amber` / `--purple`                          | Identidad de tipo de capa (recorte / texto)          |
| `--ease-out` / `--ease-in-out` / `--ease-press` | Curvas de animación                                  |
| `--button-*`                                    | Alturas, radio y padding de `Button`                 |

## Tipografía

Fuente: **Inter** (cargada en `src/main.jsx`), con fallback `Segoe UI`, `system-ui`. Base del `body`: 13px.

| Rol                         | Tamaño | Peso    | Tracking  | Notas                             |
| --------------------------- | ------ | ------- | --------- | --------------------------------- |
| Wordmark (`BERU`)           | 12px   | 700     | `0.08em`  | Mayúsculas                        |
| Título de modal             | 14px   | 600     | normal    |                                   |
| Botón / control del header  | 12px   | 500     | `-0.01em` | Primaria en 600                   |
| Título de grupo (inspector) | 11px   | 600     | `-0.01em` | `--text-secondary`                |
| Cuerpo / ayuda              | 11px   | 400–500 | `-0.01em` | `--text-dim`, `line-height: 1.45` |
| Etiqueta de sección         | 10px   | 600     | `0.04em`  | Mayúsculas, `--text-dim`          |
| Atajo de teclado (`kbd`)    | 10px   | 500     | normal    | `tabular-nums`                    |

Reglas:

- Números que cambian (contadores, workers, tiempos, píxeles): `font-variant-numeric: tabular-nums`.
- No bajar de 10px. No usar más de tres pesos en una misma superficie.
- Truncar con `text-overflow: ellipsis` y mostrar el valor completo en un tooltip.

## Espaciado, radios y alturas

- Escala de espaciado: 2, 4, 6, 8, 10, 12, 16px.
- Radios: 5px (controles internos), 7px (`--button-radius`, tooltips), 10px (grupos del inspector, segmented), 12px (menús).
- Alturas: 30px para controles del header; 24px para controles dentro de un contenedor de 30px; `--button-height-md` (34px) por defecto.
- Iconos lucide: 15px en toolbars, 14px en botones con texto, 12px en filas densas.

## Movimiento

- Entradas: 120–200ms con `var(--ease-out)`, `opacity` + `scale(0.96)` desde el origen del trigger.
- Salidas más cortas que las entradas (~90ms).
- Siempre incluir un bloque `@media (prefers-reduced-motion: reduce)` que deje solo opacidad o nada.
- Animar solo `opacity` y `transform`.

## Primitivas

Reutilizar antes de crear. Todas viven en `src/components/ui/` o `src/components/inspector/`.

| Primitiva                     | Archivo                          | Cuándo                                                                                                  |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Button`                      | `ui/Button.jsx`                  | Todo botón. Variantes: `primary`, `secondary`, `tertiary`, `danger`. Tamaños: `sm`, `md`, `lg`, `icon`. |
| `Tooltip` / `TooltipProvider` | `ui/tooltip.jsx`                 | Cualquier ayuda al pasar el cursor o enfocar.                                                           |
| `Select`                      | `ui/select.jsx`                  | Todo selector de valor. Nunca `<select>` nativo (su popup usa el azul del sistema).                     |
| `DropdownMenu*`               | `ui/dropdown-menu.jsx`           | Menús de acciones o de opciones con radio (Radix).                                                      |
| `InspectorGroup`              | `inspector/InspectorGroup.jsx`   | Secciones del panel de propiedades. `className="inspector-group--flat"` para quitar el contenedor.      |
| `SegmentedToolbar`            | `inspector/SegmentedToolbar.jsx` | Alternar entre 2–4 modos.                                                                               |
| `.cap-input`                  | `index.css`                      | Inputs de texto y número.                                                                               |
| `.inspector-empty`            | `index.css`                      | Estado vacío: icono, título y una línea de ayuda.                                                       |

### Tooltip

```jsx
<TooltipProvider>
  <Tooltip label={t("header.undo")} shortcut="Ctrl+Z">
    <Button variant="tertiary" size="icon" aria-label={t("header.undo")}>
      <Undo2 size={15} />
    </Button>
  </Tooltip>
</TooltipProvider>
```

- `label` (obligatorio para mostrarse), `description` (texto largo opcional, convierte el tooltip en tarjeta con título), `shortcut`, `side`, `align`.
- Montar un `TooltipProvider` por superficie (ya existe en `Header`), no uno por tooltip, para que el retardo compartido funcione al moverse entre botones.
- El trigger se envuelve en `span.ui-tooltip-anchor`, así funciona también con botones deshabilitados.
- **No usar el atributo nativo `title`** en controles nuevos. Todo botón solo-icono lleva `aria-label` además del `Tooltip`.
- Se oculta solo mientras el control envuelto tiene `aria-expanded="true"` (menú o select abierto) y no reaparece por el foco devuelto tras un clic; con teclado sí se muestra al enfocar.

### Select

```jsx
<Select
  variant="ghost"
  value={encodeProfile}
  onValueChange={(v) => setEncodeProfile(v)}
  aria-label={t("header.encodeProfile")}
  options={[
    { value: "fast", label: t("header.encodeFast") },
    { value: "quality", label: t("header.encodeQuality") },
  ]}
/>
```

- `options`: lista plana `{ value, label }` o grupos `{ label, options: [...] }`.
- `variant`: `field` (por defecto, con borde, ocupa el ancho del contenedor) o `ghost` (sin borde, para barras como el header).
- `size`: `md` (30px, 12px) o `sm` (28px, 11px, formularios densos y modales).
- `onValueChange` recibe siempre un string. Convertir a número en el llamador si hace falta. El valor `""` está permitido (se usa para "ninguno").
- El menú reutiliza `.ui-dropdown-content` / `.ui-dropdown-item`: fondo neutro al resaltar, check en `--accent-brand`, mismo ancho que el trigger (`--radix-select-trigger-width`), y texto de las opciones alineado con el del trigger. Una opción más larga que el trigger se trunca con ellipsis.
- Siempre con `aria-label` o un label visible asociado.

## Patrones

### Header (`src/components/Header.jsx`)

Orden de izquierda a derecha, separado por espacio (`gap`) y divisores de 1px:

1. Marca: logo + wordmark.
2. Archivos: importar, carpeta de salida. `tertiary` con icono y texto; el texto se oculta por debajo de 1360px (`.app-header-label`).
3. Ajustes de exportación: un solo contenedor `.app-header-settings` con `Select variant="ghost"` y divisores internos. Los selects del header comparten un `min-width` uniforme para que el menú, que siempre sale con el ancho del trigger, quepa sin truncar opciones. Todos los elementos del header comparten el mismo centro vertical.
4. Ejecución: probar (`tertiary`) y procesar (`primary`, única acción primaria).
5. Toolbar de iconos (`tertiary`, `size="icon"`), en subgrupos separados por `.app-header-subdivider`: historial, proyecto y presets, app.

Por debajo de 1180px las acciones se desplazan en horizontal. No añadir botones de texto nuevos al header; si la acción es secundaria, va a la toolbar de iconos o a un menú.

### Panel de propiedades

- Un único estado vacío por contexto (`.inspector-empty`). No repetir el mismo mensaje en dos bloques.
- Secciones con `InspectorGroup`; listas (capas) con `inspector-group--flat` y filas propias.
- Acción principal al final con `Button variant="primary" className="w-full"`; cancelar como enlace de texto.

## CSS

- Todo el CSS está en `src/index.css`. Agrupar las reglas de un componente en un bloque contiguo, con sus media queries justo debajo del bloque, nunca repartidas por el archivo.
- Prefijos: `cap-*` (primitivas base), `ui-*` (primitivas Radix), `inspector-*` (panel de propiedades), `app-header-*` (header), `header-*` (menús del header).
- Tailwind para layout puntual dentro de un componente; clases semánticas para todo lo que se repite o tiene estados.
- Evitar `!important`; si hace falta para ganar a una primitiva, preferir una variable CSS de la primitiva (`--button-height-sm`, `--button-foreground`).
- Todo estilo nuevo debe verse bien en tema oscuro y claro.

## Checklist antes de dar por terminado un cambio de UI

- [ ] Reutiliza primitivas y tokens; sin hex sueltos ni componentes paralelos.
- [ ] Sin `<select>` nativo; usar `Select`.
- [ ] Strings en `src/i18n/messages/{es,en}.json`.
- [ ] Botones solo-icono con `aria-label` y `Tooltip`; sin `title` nativo nuevo.
- [ ] Estados hover, foco visible, deshabilitado y reduced-motion revisados.
- [ ] Probado en tema oscuro y claro, y a 1600px, 1200px y 1000px de ancho.
- [ ] `npm run lint`, `npm run format:check` y `npm test` en verde.
