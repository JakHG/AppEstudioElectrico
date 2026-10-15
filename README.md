# Estudio Eléctrico

App web (PWA) para estudiar los exámenes eléctricos de Japón desde el celular, también sin conexión.

1. 第二種電気工事士（電工二種）— objetivo 上期 2027
2. 第一種電気工事士（電工一種）— 2028
3. 第三種電気主任技術者（電験三種）— 2028–2029

HTML, CSS y JavaScript puros. Sin frameworks, sin backend. El progreso se guarda en `localStorage` del navegador.

## Estructura

```
index.html          Estructura y vistas
styles.css          Estilos mobile first, modo oscuro automático
app.js              Selector de examen, repaso sé / no sé, progreso, enlaces
manifest.json       Instalación en pantalla de inicio
sw.js               Service worker (offline)
data/exams.json     Metadatos de los exámenes, temas y enlaces oficiales
data/denko2-kanbetsu.json   Tarjetas de 鑑別・図記号 (電工二種)
img/simbolos/       図記号 dibujados a mano en SVG (JIS C 0303)
icons/              Íconos de la app
```

## Probar en local

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

No abrir `index.html` con doble clic: `fetch()` y el service worker necesitan un servidor.

## Publicar (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → Branch `main`, carpeta `/ (root)`.
URL: `https://jakhg.github.io/AppEstudioElectrico/`. Todas las rutas son relativas, así que funciona en esa subcarpeta.

## Actualizar contenido

- **Solo JSON en `data/`:** se actualiza solo (stale-while-revalidate). El celular ve el cambio en la segunda apertura.
- **HTML, CSS, JS, imágenes:** subir `CACHE_VERSION` en `sw.js` (`v1` → `v2`). Si no, el celular sigue con la versión vieja.
- Imagen nueva: agregarla también a la lista `SHELL` de `sw.js`.

## Esquema de una tarjeta

```json
{
  "id": "d2k-001",
  "categoria": "工具 | 材料 | 器具 | 測定器 | 図記号・傍記",
  "termino": "término en japonés",
  "lectura": "lectura en kana",
  "es": "término corto en español",
  "significado": "significado en español",
  "uso": "cómo aparece en el examen",
  "verificar": false,
  "nota": "qué hay que verificar (si verificar = true)",
  "imagen": "img/... (opcional)"
}
```

`verificar: true` muestra un distintivo ⚠ en la tarjeta. JSON no admite comentarios, por eso es un campo.

## Progreso (localStorage)

- `aee.progress.v1` → `{ examen: { tema: { idTarjeta: { estado: "se" | "nose", racha, veces, fallos, ultima } } } }`
- `aee.settings.v1` → examen elegido y filtros

## Repaso

- **No sé** → muestra la respuesta (término en español, lectura, significado, uso) y la tarjeta vuelve unas 4 tarjetas después.
- Una tarjeta "por aprender" pasa a "sé" solo con 2 aciertos seguidos (`META_RACHA` en `app.js`). Tras el primer acierto vuelve unas 8 tarjetas después.
- Al abrir, el mazo empieza por las "por aprender" (las más falladas primero), luego las nuevas y al final las que ya sabes.

## Reglas de contenido

- Preguntas y textos nuevos, redactados con palabras propias. No se copian preguntas oficiales.
- Términos técnicos en japonés con lectura y significado en español.
- Las imágenes son propias. Los 図記号 se dibujan solo si la forma está verificada; si no, la tarjeta queda sin imagen.
