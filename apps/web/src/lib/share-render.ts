/**
 * Renders a share image onto a canvas: site name, date line, each chosen number and the dive
 * profile, each a block of its own placed freely (relative coordinates), over a transparent,
 * coloured or photo background.
 */
import { niceStep, type Point } from './dive-data.ts';

export type ShareFormat = 'portrait' | 'square' | 'story' | 'landscape' | 'wide' | 'photo';
export type ShareBackground = 'transparent' | 'ocean' | 'photo';
export type FontId = 'system' | 'bebas' | 'anton' | 'archivo' | 'righteous' | 'kanit' | 'bangers' | 'comic' | 'pacifico';
export type ThemeId = 'ocean' | 'ice' | 'deep' | 'coral' | 'sunset' | 'lava';
export type TemplateId = 'classic' | 'minimal' | 'profile';
export type TextColor = 'white' | 'dark' | 'accent';
/** 'title', 'subtitle', 'graph' or 'stat:<id>' */
export type BlockId = string;

const FIXED: Record<Exclude<ShareFormat, 'photo'>, [number, number]> = {
  portrait: [1080, 1350],
  square: [1080, 1080],
  story: [1080, 1920],
  landscape: [1440, 1080],
  wide: [1920, 1080],
};

/**
 * Canvas size for a format. "photo" keeps the photo's own proportions (shorter side 1080 px,
 * longer side at most 2560 px), so nothing is cut off.
 */
export function canvasSize(format: ShareFormat, photo: { width: number; height: number } | null): [number, number] {
  if (format !== 'photo') return FIXED[format];
  if (!photo || !photo.width || !photo.height) return FIXED.portrait;
  const ratio = Math.min(Math.max(photo.width / photo.height, 1 / 2.37), 2.37);
  return ratio >= 1 ? [Math.round(1080 * ratio), 1080] : [1080, Math.round(1080 / ratio)];
}

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const FONTS: Record<FontId, { label: string; family: string; weight: number; upper: boolean }> = {
  system: { label: 'Modern', family: SYSTEM, weight: 800, upper: false },
  bebas: { label: 'Bebas Neue', family: '"Bebas Neue"', weight: 400, upper: true },
  anton: { label: 'Anton', family: 'Anton', weight: 400, upper: false },
  archivo: { label: 'Archivo Black', family: '"Archivo Black"', weight: 400, upper: false },
  kanit: { label: 'Kanit', family: 'Kanit', weight: 800, upper: false },
  righteous: { label: 'Righteous', family: 'Righteous', weight: 400, upper: false },
  bangers: { label: 'Bangers (Comic)', family: 'Bangers', weight: 400, upper: true },
  comic: { label: 'Comic Neue', family: '"Comic Neue"', weight: 700, upper: false },
  pacifico: { label: 'Pacifico', family: 'Pacifico', weight: 400, upper: false },
};

interface Theme {
  text: string;
  line: string;
  fillTop: string;
  fillBottom: string;
  grid: string;
  temp: string;
  hr: string;
  /** background gradient, top to bottom */
  ocean: [string, string, string];
}

export const THEMES: Record<ThemeId, Theme> = {
  ocean: {
    text: '#ffffff', line: '#c8ecff', fillTop: 'rgba(120,200,245,0.65)', fillBottom: 'rgba(40,120,200,0.10)',
    grid: 'rgba(255,255,255,0.28)', temp: '#ffd29e', hr: '#ffb3c7', ocean: ['#0e6a9c', '#063c5c', '#021a2a'],
  },
  ice: {
    text: '#ffffff', line: '#ffffff', fillTop: 'rgba(255,255,255,0.42)', fillBottom: 'rgba(255,255,255,0.04)',
    grid: 'rgba(255,255,255,0.3)', temp: '#fff1c9', hr: '#ffd6e2', ocean: ['#4fb3d9', '#1c6f9c', '#0b3550'],
  },
  deep: {
    text: '#e6f6ff', line: '#4fc3f7', fillTop: 'rgba(79,195,247,0.55)', fillBottom: 'rgba(13,71,161,0.08)',
    grid: 'rgba(79,195,247,0.3)', temp: '#ffcc80', hr: '#f48fb1', ocean: ['#0a2a4a', '#06182c', '#020a14'],
  },
  coral: {
    text: '#ffffff', line: '#ffb066', fillTop: 'rgba(255,159,67,0.62)', fillBottom: 'rgba(255,94,58,0.08)',
    grid: 'rgba(255,255,255,0.32)', temp: '#fff3b0', hr: '#ffd1dc', ocean: ['#ff9a5a', '#e8573c', '#5a1f2e'],
  },
  sunset: {
    text: '#ffffff', line: '#ffd166', fillTop: 'rgba(255,209,102,0.6)', fillBottom: 'rgba(239,71,111,0.1)',
    grid: 'rgba(255,255,255,0.32)', temp: '#ffffff', hr: '#ffc2e2', ocean: ['#ffb347', '#ef476f', '#3a0ca3'],
  },
  lava: {
    text: '#fff4e6', line: '#ff7a3d', fillTop: 'rgba(255,107,53,0.62)', fillBottom: 'rgba(140,30,10,0.1)',
    grid: 'rgba(255,170,120,0.32)', temp: '#ffd166', hr: '#ff9eb5', ocean: ['#4a1408', '#1f0905', '#000000'],
  },
};

export interface Box {
  /** left edge, 0–1 of the width */
  x: number;
  /** top edge, 0–1 of the height */
  y: number;
  /** width, 0–1 (graph only) */
  w: number;
  /** height, 0–1 (graph only) */
  h: number;
}

export type Layout = Record<BlockId, Box>;

export const statBlock = (id: string): BlockId => `stat:${id}`;

/**
 * Where the blocks go in a template, for the chosen numbers and the canvas size. Numbers are laid
 * out in rows of three (four on landscape formats, fewer with large text); each can be moved on
 * its own afterwards.
 */
export function templateLayout(name: TemplateId, statIds: readonly string[], [W, H]: [number, number], fontScale = 1): Layout {
  const u = Math.min(W, H) / 1080;
  const pad = 0.067;
  const perRow = Math.max(1, Math.round((W > H * 1.2 ? 4 : 3) / Math.max(fontScale, 1)));
  const rows = Math.max(1, Math.ceil(statIds.length / perRow));
  const titleH = (110 * u * fontScale) / H;
  const statH = (150 * u * fontScale) / H;
  const [titleY, statsY, graph] =
    name === 'minimal'
      ? [0.5, 0.5 + titleH + 0.06, { x: pad, y: 0.08, w: 1 - 2 * pad, h: 0.2 }]
      : name === 'profile'
        ? [0.05, 0.94 - rows * statH, { x: pad, y: 0.05 + titleH + 0.08, w: 1 - 2 * pad, h: 0.9 - rows * statH - (0.05 + titleH + 0.1) }]
        : [0.05, Math.min(0.44, 0.66 - rows * statH), { x: pad, y: 0.68, w: 1 - 2 * pad, h: 0.24 }];
  const layout: Layout = {
    title: { x: pad, y: titleY, w: 0, h: 0 },
    subtitle: { x: pad, y: titleY + titleH, w: 0, h: 0 },
    graph,
  };
  statIds.forEach((id, i) => {
    layout[statBlock(id)] = { x: pad + (i % perRow) * ((1 - 2 * pad) / perRow), y: statsY + Math.floor(i / perRow) * statH, w: 0, h: 0 };
  });
  return layout;
}

export interface GraphOptions {
  show: boolean;
  /** horizontal depth lines with labels */
  grid: boolean;
  maxMarker: boolean;
  temp: boolean;
  hr: boolean;
}

export interface ShareContent {
  points: Point[];
  title: string;
  subtitle: string;
  stats: { id: string; label: string; value: string }[];
  footer: string;
  /** formats a depth in metres for labels, e.g. "14,9 m" */
  depth: (m: number) => string;
}

export interface ShareStyle {
  format: ShareFormat;
  background: ShareBackground;
  photo: ImageBitmap | null;
  font: FontId;
  italic: boolean;
  /** 0.6–1.6, multiplies all text */
  fontScale: number;
  theme: ThemeId;
  /** white (the theme's text colour), dark, or the theme's line colour */
  textColor: TextColor;
  layout: Layout;
  graph: GraphOptions;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const displayFont = (font: FontId, italic: boolean, size: number) => {
  const f = FONTS[font];
  return `${italic ? 'italic ' : ''}${f.weight} ${size}px ${f.family}, ${SYSTEM}`;
};

/** Make sure a web font is loaded before drawing with it on a canvas. */
export async function loadFont(font: FontId, italic = false): Promise<void> {
  if (font === 'system' || !document.fonts) return;
  await document.fonts.load(displayFont(font, italic, 64));
}

/** Draws the image and returns where each block ended up, for dragging. */
export function renderShare(canvas: HTMLCanvasElement, content: ShareContent, style: ShareStyle): Record<BlockId, Rect> {
  const [W, H] = canvasSize(style.format, style.photo);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const base = THEMES[style.theme];
  // Dark text gets a light glow instead of the dark shadow, so it stays readable on dark spots.
  const dark = style.textColor === 'dark';
  const theme: Theme = { ...base, text: dark ? '#0b1e2b' : style.textColor === 'accent' ? base.line : base.text };
  const shadow = dark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 20, 40, 0.45)';
  const font = FONTS[style.font];
  /** one unit: 1 px on a 1080 px wide portrait image */
  const u = Math.min(W, H) / 1080;
  const k = u * style.fontScale;
  const display = (size: number) => displayFont(style.font, style.italic, size);
  const shown = (text: string) => (font.upper ? text.toUpperCase() : text);
  const plain = (weight: number, size: number) => `${style.italic ? 'italic ' : ''}${weight} ${size}px ${SYSTEM}`;
  ctx.clearRect(0, 0, W, H);

  drawBackground(ctx, W, H, style, theme);

  const pad = Math.round(Math.min(W, H) * 0.067);
  const rects: Record<BlockId, Rect> = {};
  const place = (id: BlockId) => style.layout[id] ?? { x: 0.067, y: 0.05, w: 0, h: 0 };
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.text;
  ctx.shadowColor = shadow;
  ctx.shadowBlur = 14 * u;

  if (content.title) {
    const box = place('title');
    const x = box.x * W;
    const y = box.y * H;
    const text = shown(content.title);
    const size = fit(ctx, text, display, 84 * k, W - x - pad, 24 * u);
    ctx.fillText(text, x, y + size);
    rects.title = { x, y, w: Math.max(ctx.measureText(text).width, 60 * u), h: size * 1.2 };
  }

  if (content.subtitle) {
    const box = place('subtitle');
    const x = box.x * W;
    const y = box.y * H;
    const size = fit(ctx, content.subtitle, (s) => plain(500, s), 36 * k, W - x - pad / 2, 16 * u);
    ctx.globalAlpha = 0.85;
    ctx.fillText(content.subtitle, x, y + size);
    ctx.globalAlpha = 1;
    rects.subtitle = { x, y, w: Math.max(ctx.measureText(content.subtitle).width, 60 * u), h: size * 1.35 };
  }

  for (const stat of content.stats) {
    const id = statBlock(stat.id);
    const box = place(id);
    const x = box.x * W;
    const y = box.y * H;
    ctx.font = plain(700, 26 * k);
    ctx.globalAlpha = 0.75;
    const label = stat.label.toUpperCase();
    ctx.fillText(label, x, y + 30 * k);
    ctx.globalAlpha = 1;
    const labelW = ctx.measureText(label).width;
    const value = shown(stat.value);
    fit(ctx, value, display, 72 * k, Math.max(W - x - pad / 2, 120 * u), 24 * u);
    ctx.fillText(value, x, y + 110 * k);
    rects[id] = { x, y, w: Math.max(labelW, ctx.measureText(value).width, 60 * u), h: 130 * k };
  }

  if (style.graph.show && content.points.length > 1) {
    const box = place('graph');
    const r = { x: box.x * W, y: box.y * H, w: box.w * W, h: box.h * H };
    drawGraph(ctx, r, content, style.graph, theme, u, k);
    rects.graph = r;
  }

  ctx.shadowColor = shadow;
  ctx.shadowBlur = 14 * u;
  if (content.footer) {
    ctx.font = `600 ${28 * u}px ${SYSTEM}`;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right';
    ctx.fillText(content.footer, W - pad, H - pad / 1.5);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0;
  return rects;
}

function fit(ctx: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, maxWidth: number, min: number): number {
  let s = size;
  ctx.font = font(s);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(s);
  }
  return s;
}

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, style: ShareStyle, theme: Theme): void {
  if (style.background === 'ocean') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.ocean[0]);
    g.addColorStop(0.55, theme.ocean[1]);
    g.addColorStop(1, theme.ocean[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (style.background === 'photo' && style.photo) {
    const img = style.photo;
    // cover: the photo fills the image; in the photo's own format nothing is cut off
    const scale = Math.max(W / img.width, H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(2,20,35,0.5)');
    g.addColorStop(0.3, 'rgba(2,20,35,0.05)');
    g.addColorStop(0.55, 'rgba(2,20,35,0.05)');
    g.addColorStop(1, 'rgba(2,20,35,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

/**
 * Depth profile in the upper part of the box; temperature and heart rate, if chosen, as thin
 * bands below it, each with its own min–max label (no shared axis). `u` scales lines, `k` text.
 */
function drawGraph(ctx: CanvasRenderingContext2D, r: Rect, content: ShareContent, options: GraphOptions, theme: Theme, u: number, k: number): void {
  const pts = content.points;
  const temps = pts.filter((p) => p.temp !== null).map((p) => p.temp!);
  const hrs = pts.filter((p) => p.hr !== null).map((p) => p.hr!);
  const bands = [
    options.temp && temps.length > 1 ? { key: 'temp' as const, values: temps, color: theme.temp, unit: '°C' } : null,
    options.hr && hrs.length > 1 ? { key: 'hr' as const, values: hrs, color: theme.hr, unit: 'bpm' } : null,
  ].filter((b) => b !== null);
  const bandH = Math.min(90 * u, r.h * 0.18);
  const bandGap = 26 * u;
  const depthH = r.h - bands.length * (bandH + bandGap);
  const labelW = options.grid ? 96 * k : 0;
  const left = r.x + labelW;
  const width = r.w - labelW;

  const maxT = Math.max(pts.at(-1)!.t, 1);
  const maxD = Math.max(...pts.map((p) => p.depth), 1);
  const px = (t: number) => left + (t / maxT) * width;
  const py = (d: number) => r.y + (d / maxD) * depthH;

  ctx.shadowBlur = 0;
  ctx.lineWidth = 2 * u;

  if (options.grid) {
    const step = Math.max(5, niceStep(maxD, 3));
    ctx.font = `600 ${26 * k}px ${SYSTEM}`;
    ctx.textAlign = 'right';
    for (let d = 0; d <= maxD + 0.01; d += step) {
      const y = py(d);
      ctx.strokeStyle = theme.grid;
      ctx.setLineDash(d === 0 ? [10 * u, 12 * u] : [4 * u, 10 * u]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 0.75;
      ctx.fillText(`${d} m`, left - 14 * u, y + 9 * k);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  } else {
    ctx.strokeStyle = theme.grid;
    ctx.setLineDash([10 * u, 12 * u]);
    ctx.beginPath();
    ctx.moveTo(left, r.y);
    ctx.lineTo(left + width, r.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const path = new Path2D();
  pts.forEach((p, i) => (i ? path.lineTo(px(p.t), py(p.depth)) : path.moveTo(px(p.t), py(p.depth))));
  const area = new Path2D(path);
  area.lineTo(px(pts.at(-1)!.t), r.y);
  area.lineTo(px(pts[0]!.t), r.y);
  area.closePath();
  const fill = ctx.createLinearGradient(0, r.y, 0, r.y + depthH);
  fill.addColorStop(0, theme.fillTop);
  fill.addColorStop(1, theme.fillBottom);
  ctx.fillStyle = fill;
  ctx.fill(area);

  ctx.shadowColor = 'rgba(0, 20, 40, 0.5)';
  ctx.shadowBlur = 10 * u;
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 6 * u;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(path);

  if (options.maxMarker) {
    const deepest = pts.reduce((a, b) => (b.depth > a.depth ? b : a));
    const dx = px(deepest.t);
    const dy = py(deepest.depth);
    ctx.fillStyle = theme.text;
    ctx.beginPath();
    ctx.arc(dx, dy, 11 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `800 ${34 * k}px ${SYSTEM}`;
    const label = content.depth(deepest.depth);
    const w = ctx.measureText(label).width;
    // Below the dot, or above it when temperature or heart-rate bands follow underneath
    ctx.fillText(label, Math.min(Math.max(dx - w / 2, left), left + width - w), bands.length ? dy - 26 * u : dy + 52 * k);
  }
  ctx.shadowBlur = 0;

  let top = r.y + depthH + bandGap;
  for (const band of bands) {
    const lo = Math.min(...band.values);
    const hi = Math.max(...band.values);
    const span = hi - lo || 1;
    const by = (v: number) => top + bandH - ((v - lo) / span) * bandH;
    const line = new Path2D();
    let pen = false;
    for (const p of pts) {
      const v = band.key === 'temp' ? p.temp : p.hr;
      if (v === null) {
        pen = false;
        continue;
      }
      if (pen) line.lineTo(px(p.t), by(v));
      else line.moveTo(px(p.t), by(v));
      pen = true;
    }
    ctx.strokeStyle = band.color;
    ctx.lineWidth = 4 * u;
    ctx.stroke(line);
    ctx.fillStyle = theme.text;
    ctx.font = `600 ${24 * k}px ${SYSTEM}`;
    ctx.globalAlpha = 0.8;
    const fmt = (v: number) => (band.key === 'temp' ? v.toFixed(0) : String(Math.round(v)));
    ctx.textAlign = 'right';
    ctx.fillText(`${fmt(hi)} ${band.unit}`, left - 14 * u, top + 20 * k);
    ctx.fillText(`${fmt(lo)}`, left - 14 * u, top + bandH);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    top += bandH + bandGap;
  }
}
