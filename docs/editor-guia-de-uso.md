# Editor de video — guía de uso

El Editor de video monta varios videos en una secuencia, añade títulos e imágenes, y exporta un MP4.
Se abre desde el botón de película de la barra lateral («Editor de video»).

El Editor comparte el motor de composición de Beru. Admite hasta 50 clips por montaje, lienzos de
16–4096 píxeles por lado (dimensiones pares), 1–120 FPS y una duración máxima de dos horas.
Los proyectos conservan su formato de edición; al exportar se compilan al contrato común de composición.

La pantalla sigue el esquema de los editores habituales: biblioteca a la izquierda, reproductor en el
centro, panel de propiedades a la derecha y línea de tiempo a lo ancho en la parte inferior. La barra
superior solo tiene abrir, guardar, el nombre del proyecto y **Exportar MP4**.

## Flujo básico

1. **Importar.** Pulsa **Importar** en la biblioteca y elige uno o varios videos. El primer video que
   importas entra solo al montaje, y el lienzo toma su proporción (sin superar 1920 píxeles).
2. **Montar.** Arrastra un video de la biblioteca a la línea de tiempo: una línea marca dónde entrará.
   También puedes pasar el cursor sobre el video y pulsar **+** (**Añadir al montaje**) para añadirlo al
   final. Con la línea de tiempo vacía, haz clic en el recuadro punteado para importar.
3. **Recortar.** Selecciona un clip en la línea de tiempo y ajusta **Inicio (s)** y **Fin (s)** en
   el grupo **Rango** de la pestaña **Básico** del panel de propiedades. Los cambios se confirman al salir del campo o al pulsar Intro.
4. **Guardar.** **Guardar** y **Guardar como** escriben un proyecto `.beru-edit.json`. El proyecto guarda
   rutas y montaje, no el contenido de los videos.
5. **Exportar.** **Exportar MP4** pide el destino y genera el archivo con el motor de Beru. Elige antes el
   **Perfil de calidad** (Rápido, Balanceado, Calidad o U Quality) y el audio en el grupo **Exportación**
   del panel **Proyecto**, que aparece cuando no hay nada seleccionado. Puedes cancelar con
   **Cancelar** mientras se exporta.

## Clips

Con un clip seleccionado, el panel de propiedades se divide en pestañas: **Básico** (rango, transformación
y recorte), **Audio** y **Velocidad**. Ofrece:

- **Velocidad** de 0,25× a 4×. El clip cambia de duración en la línea de tiempo y su audio se
  acompasa.
- **Silenciar clip** quita el audio del clip.
- **Girar** en pasos de 90°, y **Voltear H** / **Voltear V**.
- **Ajuste**: _Ajustar dentro_ muestra el video completo; _Llenar_ cubre el lienzo y puede recortar los bordes.
- **Zoom** y **Desplazar X / Y**.
- **Recorte (0–1)** con x, y, ancho y alto en fracciones del video.

Dividir (**S**), duplicar (**D**) y quitar (**Suprimir**) actúan sobre el clip seleccionado. Los mismos
comandos, junto con deshacer y rehacer, están en la barra de la línea de tiempo. A la derecha de esa barra,
el control deslizante ajusta el zoom entre alejar y acercar. El clic derecho sobre un clip abre el
menú con dividir, duplicar y eliminar.

## Títulos e imágenes

- **Título** añade un texto en el playhead, durante 3 segundos. Edita el texto, el tamaño (porcentaje de
  la altura del lienzo), el color y el intervalo en el inspector, y quítalo con **Quitar**.
- El panel de un título tiene tres pestañas: **Texto**, **Estilo** y **Posición**.
- Las opciones de texto son las de Beru: **Fuente** (Arial o Segoe UI), **Negrita**, **Cursiva**,
  **Alineación** (izquierda, centro o derecha, también para varias líneas), **Opacidad**, **Contorno** con
  su color, **Sombra** y **Fondo** con su color y opacidad. El contorno y la sombra se miden en
  proporción al tamaño del texto, así que la vista previa y la exportación coinciden en cualquier lienzo.
- **Imagen** importa una imagen (PNG, JPG, WEBP, GIF o BMP) y la coloca en el playhead. También puedes
  usar **Añadir capa** en las imágenes de la biblioteca.
- La caja (x, y, ancho, alto) va en fracciones del lienzo, de 0 a 1. El texto se centra en su caja; la
  imagen se ajusta dentro de su caja, pegada arriba a la izquierda.
- En la línea de tiempo, arrastra un título o imagen para moverlo y arrastra sus bordes para cambiar
  cuándo empieza o termina. Los bordes se ajustan al playhead y a los cortes cercanos.
- Un título o imagen solo se ve durante su intervalo.

## Lienzo

El selector de proporción, en la barra del reproductor, ofrece 16:9, 9:16 y 1:1. **Personalizado** abre el
panel **Proyecto**, donde se escriben el ancho y el alto. El botón de la derecha muestra la vista previa a
pantalla completa (Esc para salir).
Las dimensiones se redondean a números pares, porque el formato H.264 no admite dimensiones impares.
**Fondo** elige el color que queda detrás del video cuando la proporción no coincide.

## Vista exacta

**Vista exacta** muestra un fotograma del montaje en el instante del playhead, renderizado con el mismo
proceso que la exportación. Es la referencia cuando la vista previa en vivo no coincide, por ejemplo con
recortes, rotaciones o zoom.

## Archivos movidos o cambiados

Si un video del proyecto ya no está en su ruta, la biblioteca lo marca como **Archivo no encontrado** o
**El archivo cambió**. Pulsa **Buscar archivo** y elige el archivo. El clip conserva sus recortes y su
posición en el montaje.

## Atajos

| Tecla                 | Acción                                                       |
| --------------------- | ------------------------------------------------------------ |
| Espacio               | Reproducir o pausar                                          |
| ← / →                 | Un fotograma atrás o adelante (con Mayús, un segundo)        |
| Inicio / Fin          | Ir al principio o al final del montaje                       |
| S                     | Dividir el clip bajo el playhead                             |
| D                     | Duplicar el clip seleccionado                                |
| Suprimir              | Quitar el clip o el título seleccionado                      |
| + / − / 0             | Acercar, alejar, o restablecer el zoom de la línea de tiempo |
| Ctrl+S / Ctrl+Mayús+S | Guardar / Guardar como                                       |
| Ctrl+O                | Abrir un proyecto                                            |
| Ctrl+Z / Ctrl+Y       | Deshacer / Rehacer                                           |
| Escape                | Cancelar un arrastre en curso                                |

Los atajos no actúan mientras escribes en un campo de texto.

## Límites conocidos

- Títulos e imágenes se mueven y se redimensionan con los campos numéricos, no arrastrando sobre el preview.
- Las fuentes de los títulos son Arial o Segoe UI del sistema. No hay animaciones. Los títulos no ofrecen
  espaciado entre letras, interlineado, ajuste automático de texto ni truncado: las líneas se separan solo
  con saltos de línea.
- La vista exacta es la referencia: la vista en vivo dibuja el clip con la misma geometría, pero el
  renderizado puede diferir en detalles de remuestreo.
- Un montaje admite hasta 50 clips y 50 títulos o imágenes.
- La exportación usa solo codificación por software (libx264).
- Formatos probados: se previsualizan directamente MP4 (H.264 y AV1), MKV (H.264), MOV (H.264) y WebM (VP9). HEVC en MP4, AVI (MPEG-4), FLV (H.264), WMV y MPG no se reproducen en la vista previa: el Editor muestra un aviso y el botón **Crear proxy de vista previa**, que genera una copia de vista previa en un par de segundos. Todos esos formatos se exportan igual.
- Búsquedas lentas: si buscar dentro de un video original tarda mucho (el percentil 90 de las últimas 12 búsquedas pasa de 150 ms, como ocurre con un fotograma clave cada 250 fotogramas en 720p), el Editor pide el proxy de ese video por su cuenta, una vez en cada documento abierto, y la vista previa pasa a esa copia cuando está lista. Aparece un aviso cuando la copia está lista, o con el error si no se puede crear; en ese caso no vuelve a pedirla hasta reabrir el documento. La exportación sigue usando siempre el original.
- Arrastrar un clip solo reordena dentro de la única pista de video.
