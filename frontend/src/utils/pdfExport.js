/**
 * Turning the rendered report into an actual PDF file.
 *
 * This used to be `window.print()`: the report was a print stylesheet and the user
 * picked "Save as PDF" out of the browser dialog. That kept the charts as vectors,
 * but it also meant the file was whatever the dialog was set to — margins, headers,
 * background graphics off by default, and a different dialog on every platform. The
 * export is generated here instead, so the file is the same everywhere and can carry
 * the account's own theme and background rather than bare white paper.
 *
 * The cost of that choice is rasterisation: html2canvas draws each block to a canvas
 * and the text in the PDF is an image, not selectable glyphs. It is drawn at twice
 * the page resolution to keep it sharp, and the report already writes out every
 * figure the screen hides in a tooltip, so nothing is lost that a text layer would
 * have given back.
 *
 * Pagination works on blocks, not pixels. Each `[data-pdf-block]` — the header, each
 * section, the footer — is rasterised on its own and placed whole if it fits on what
 * is left of the page, or moved to the next one if it does not. A block taller than a
 * whole page (the all-figures table on a large fleet) is the only one that gets cut,
 * and then only across its own rows.
 */
// A4 portrait in millimetres, and the margins the content sits inside.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 10;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 12;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const USABLE_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
const BLOCK_GAP = 4;

// Twice the 96 dpi the report is laid out at. Higher looks no better on screen and
// costs file size linearly in both dimensions.
const SCALE = 2;

// The background is painted at ~150 dpi. It is a wash of soft gradients with no fine
// detail, so it survives both the lower resolution and the JPEG it is stored as.
const BG_W = 1240;
const BG_H = 1754;

/**
 * The page background: the same wash `.app-shell::before` and `::after` paint on
 * screen, drawn straight onto a canvas rather than through CSS.
 *
 * The CSS uses `color-mix()` and a mask, neither of which html2canvas can be trusted
 * with, and the whole point is one image reused on every page — so it is rebuilt here
 * from the same numbers. The percentages are the gradient stops from App.css; the
 * radii resolve them against the farthest corner, which is what `radial-gradient`
 * defaults to.
 */
function paintBackground(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = BG_W;
  canvas.height = BG_H;
  const ctx = canvas.getContext('2d');
  const dark = theme.mode === 'dark';
  const diagonal = Math.hypot(BG_W, BG_H);

  const base = ctx.createLinearGradient(0, 0, 0, BG_H);
  base.addColorStop(0, mixToward(theme.background, '#FFFFFF', dark ? 0.04 : 0.6));
  base.addColorStop(1, theme.background);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, BG_W, BG_H);

  glow(ctx, 0, 0, diagonal * 0.3, theme.brand.primary, dark ? 0.15 : 0.09);
  glow(ctx, BG_W * 0.85, BG_H * 0.15, diagonal * 0.26, theme.brand.secondary, dark ? 0.14 : 0.08);

  // The 52px grid, faded out down the page the way the mask does on screen. A
  // gradient as the stroke style does the fade for horizontal and vertical lines
  // alike, which drawing them at a flat alpha could not.
  const fade = ctx.createLinearGradient(0, 0, 0, BG_H);
  fade.addColorStop(0, theme.grid);
  fade.addColorStop(0.92, 'rgba(0, 0, 0, 0)');
  ctx.strokeStyle = fade;
  ctx.lineWidth = 1;
  const step = 52 * (BG_W / 794);
  ctx.beginPath();
  for (let x = step; x < BG_W; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, BG_H);
  }
  for (let y = step; y < BG_H; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(BG_W, Math.round(y) + 0.5);
  }
  ctx.stroke();

  return canvas.toDataURL('image/jpeg', 0.92);
}

function glow(ctx, x, y, radius, color, alpha) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgbaFrom(color, alpha));
  gradient.addColorStop(1, rgbaFrom(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

const channels = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const rgbaFrom = (hex, alpha) => `rgba(${channels(hex).join(', ')}, ${alpha})`;

const mixToward = (hex, other, weight) => {
  const a = channels(hex);
  const b = channels(other);
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * weight)).join(', ')})`;
};

/** One block's raster, plus the height it will occupy on the page in millimetres. */
async function rasterise(html2canvas, element) {
  const canvas = await html2canvas(element, {
    scale: SCALE,
    // The wash is already on the page underneath; a block that painted its own
    // background would cover it with a rectangle of flat colour.
    backgroundColor: null,
    logging: false,
    useCORS: true,
  });
  return { canvas, mmPerPx: CONTENT_W / canvas.width };
}

/** A horizontal band of a canvas, as its own image. Used only to split tall blocks. */
function sliceOf(canvas, top, height) {
  const slice = document.createElement('canvas');
  slice.width = canvas.width;
  slice.height = height;
  slice.getContext('2d').drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
  return slice.toDataURL('image/png');
}

/**
 * Render the mounted report into a PDF and hand it to the browser as a download.
 *
 * `root` is the report element, already in the document and laid out — it cannot be
 * `display: none`, because a hidden element measures zero and every chart inside it
 * would rasterise empty.
 */
export async function exportReportToPdf(root, theme, fileName) {
  const blocks = Array.from(root.querySelectorAll('[data-pdf-block]'));
  if (!blocks.length) throw new Error('Nothing to export');

  // Loaded here rather than at the top of the file: the two of them are some 350 kB of
  // the bundle, for a button most sessions never press. The report is already mounted
  // and laid out by the time this runs, so the wait is off the page's critical path.
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas-pro'),
  ]);

  const rasters = [];
  for (const block of blocks) {
    // Sequentially: html2canvas clones the document for each call, and running a
    // dozen of those at once on a page this size is how the tab runs out of memory.
    rasters.push(await rasterise(html2canvas, block));
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const background = paintBackground(theme);
  let cursor = MARGIN_TOP;
  let pageStarted = false;

  const startPage = () => {
    if (pageStarted) doc.addPage();
    doc.addImage(background, 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');
    pageStarted = true;
    cursor = MARGIN_TOP;
  };

  startPage();

  for (const { canvas, mmPerPx } of rasters) {
    const height = canvas.height * mmPerPx;

    if (height <= USABLE_H) {
      if (cursor + height > PAGE_H - MARGIN_BOTTOM) startPage();
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', MARGIN_X, cursor, CONTENT_W, height);
      cursor += height + BLOCK_GAP;
      continue;
    }

    // Taller than a page on its own. Cut it into page-sized bands, starting on a
    // fresh page so the first cut is not made worse by whatever came before it.
    if (cursor > MARGIN_TOP) startPage();
    let top = 0;
    while (top < canvas.height) {
      const available = PAGE_H - MARGIN_BOTTOM - cursor;
      const bandPx = Math.min(canvas.height - top, Math.floor(available / mmPerPx));
      doc.addImage(sliceOf(canvas, top, bandPx), 'PNG', MARGIN_X, cursor, CONTENT_W, bandPx * mmPerPx);
      top += bandPx;
      if (top < canvas.height) startPage();
      else cursor += bandPx * mmPerPx + BLOCK_GAP;
    }
  }

  doc.save(fileName);
}

/** `mileage-analytics-90-days-2026-08-11.pdf` */
export function reportFileName(rangeLabel) {
  const slug = String(rangeLabel || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const day = new Date().toISOString().slice(0, 10);
  return `mileage-analytics-${slug}-${day}.pdf`;
}
