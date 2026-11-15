/**
 * Renders a share image onto a canvas: title, a block of chosen numbers and the dive profile,
 * each placed freely (relative coordinates), in blue-toned themes over a transparent, ocean or
 * photo background.
 */
import { niceStep, type Point } from './dive-data.ts';

export type ShareFormat = 'portrait' | 'square' | 'story';
export type ShareBackground = 'transparent' | 'ocean' | 'photo';
export type FontId = 'system' | 'bebas' | 'anton' | 'archivo' | 'righteous';
export type ThemeId = 'ocean' | 'ice' | 'deep';
export type BlockId = 'title' | 'stats' | 'graph';

export const SIZES: Record<ShareFormat, [number, number]> = {
  portrait: [1080, 1350],
  square: [1080, 1080],
  story: [1080, 1920],
};

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const FONTS: Record<FontId, { label: string; family: string; weight: number; upper: boolean }> = {
  system: { label: 'Modern', family: SYSTEM, weight: 800, upper: false },
  bebas: { label: 'Bebas Neue', family: '"Bebas Neue"', weight: 400, upper: true },
  anton: { label: 'Anton', family: 'Anton', weight: 400, upper: false },
  archivo: { label: 'Archivo Black', family: '"Archivo Black"', weight: 400, upper: false },
  righteous: { label: 'Righteous', family: 'Righteous', weight: 400, upper: false },
};

interface Theme {
  text: string;
  line: string;
  fillTop: string;
  fillBottom: string;
  grid: string;
  temp: string;
  hr: string;
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

export const TEMPLATES: Record<'classic' | 'minimal' | 'profile', Layout> = {
  classic: {
    title: { x: 0.067, y: 0.05, w: 0, h: 0 },
    stats: { x: 0.067, y: 0.44, w: 0, h: 0 },
    graph: { x: 0.067, y: 0.68, w: 0.866, h: 0.24 },
  },
  minimal: {
    graph: { x: 0.067, y: 0.08, w: 0.866, h: 0.2 },
    title: { x: 0.067, y: 0.5, w: 0, h: 0 },
    stats: { x: 0.067, y: 0.7, w: 0, h: 0 },
  },
  profile: {
    title: { x: 0.067, y: 0.05, w: 0, h: 0 },
    graph: { x: 0.067, y: 0.24, w: 0.866, h: 0.42 },
    stats: { x: 0.067, y: 0.74, w: 0, h: 0 },
  },
};

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
  stats: { label: string; value: string }[];
  footer: string;
  /** formats a depth in metres for labels, e.g. "14,9 m" */
  depth: (m: number) => string;
}

export interface ShareStyle {
  format: ShareFormat;
  background: ShareBackground;
  photo: ImageBitmap | null;
  font: FontId;
  theme: ThemeId;
  columns: number;
  layout: Layout;
  graph: GraphOptions;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Make sure a web font is loaded before drawing with it on a canvas. */
export async function loadFont(font: FontId): Promise<void> {
  if (font === 'system' || !document.fonts) return;
  const f = FONTS[font];
  await document.fonts.load(`${f.weight} 64px ${f.family}`);
}

/** Draws the image and returns where each block ended up, for dragging. */
export function renderShare(canvas: HTMLCanvasElement, content: ShareContent, style: ShareStyle): Record<BlockId, Rect> {
  const [W, H] = SIZES[style.format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const theme = THEMES[style.theme];
  const font = FONTS[style.font];
  const display = (size: number) => `${font.weight} ${size}px ${font.family}, ${SYSTEM}`;
  const shown = (text: string) => (font.upper ? text.toUpperCase() : text);
  ctx.clearRect(0, 0, W, H);

  drawBackground(ctx, W, H, style, theme);

  const pad = Math.round(W * 0.067);
  const rects: Record<BlockId, Rect> = { title: none(), stats: none(), graph: none() };
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.text;
  ctx.shadowColor = 'rgba(0, 20, 40, 0.45)';
  ctx.shadowBlur = 14;

  // Title block
  {
    const x = style.layout.title.x * W;
    let y = style.layout.title.y * H;
    const maxW = W - x - pad;
    const top = y;
    let width = 0;
    if (content.title) {
      const size = fit(ctx, shown(content.title), display, 84, maxW);
      y += size;
      ctx.fillText(shown(content.title), x, y);
      width = Math.max(width, ctx.measureText(shown(content.title)).width);
    }
    if (content.subtitle) {
      ctx.font = `500 36px ${SYSTEM}`;
      y += 52;
      ctx.globalAlpha = 0.85;
      ctx.fillText(content.subtitle, x, y);
      ctx.globalAlpha = 1;
      width = Math.max(width, ctx.measureText(content.subtitle).width);
    }
    rects.title = { x, y: top, w: Math.max(width, 120), h: Math.max(y - top + 14, 60) };
  }

  // Stats block
  if (content.stats.length) {
    const x = style.layout.stats.x * W;
    const top = style.layout.stats.y * H;
    const columns = Math.max(1, Math.min(style.columns, content.stats.length));
    const colW = (W - x - pad) / columns;
    const rowH = 150;
    content.stats.forEach((stat, i) => {
      const cx = x + (i % columns) * colW;
      const cy = top + Math.floor(i / columns) * rowH;
      ctx.font = `700 26px ${SYSTEM}`;
      ctx.globalAlpha = 0.75;
      ctx.fillText(stat.label.toUpperCase(), cx, cy + 30);
      ctx.globalAlpha = 1;
      fit(ctx, shown(stat.value), display, 72, colW - 20);
      ctx.fillText(shown(stat.value), cx, cy + 110);
    });
    rects.stats = { x, y: top, w: colW * columns, h: Math.ceil(content.stats.length / columns) * rowH };
  }

  // Graph block
  if (style.graph.show && content.points.length > 1) {
    const box = style.layout.graph;
    const r = { x: box.x * W, y: box.y * H, w: box.w * W, h: box.h * H };
    drawGraph(ctx, r, content, style.graph, theme);
    rects.graph = r;
  }

  // Footer
  ctx.shadowBlur = 14;
  if (content.footer) {
    ctx.font = `600 28px ${SYSTEM}`;
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

const none = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });

function fit(ctx: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, maxWidth: number): number {
  let s = size;
  ctx.font = font(s);
  while (s > 24 && ctx.measureText(text).width > maxWidth) {
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
 * bands below it, each with its own min–max label (no shared axis).
 */
function drawGraph(ctx: CanvasRenderingContext2D, r: Rect, content: ShareContent, options: GraphOptions, theme: Theme): void {
  const pts = content.points;
  const temps = pts.filter((p) => p.temp !== null).map((p) => p.temp!);
  const hrs = pts.filter((p) => p.hr !== null).map((p) => p.hr!);
  const bands = [
    options.temp && temps.length > 1 ? { key: 'temp' as const, values: temps, color: theme.temp, unit: '°C' } : null,
    options.hr && hrs.length > 1 ? { key: 'hr' as const, values: hrs, color: theme.hr, unit: 'bpm' } : null,
  ].filter((b) => b !== null);
  const bandH = Math.min(90, r.h * 0.18);
  const bandGap = 26;
  const depthH = r.h - bands.length * (bandH + bandGap);
  const labelW = options.grid ? 96 : 0;
  const left = r.x + labelW;
  const width = r.w - labelW;

  const maxT = Math.max(pts.at(-1)!.t, 1);
  const maxD = Math.max(...pts.map((p) => p.depth), 1);
  const px = (t: number) => left + (t / maxT) * width;
  const py = (d: number) => r.y + (d / maxD) * depthH;

  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;

  // Depth lines (every 5 or 10 m) or just the surface
  if (options.grid) {
    const step = Math.max(5, niceStep(maxD, 3));
    ctx.font = `600 26px ${SYSTEM}`;
    ctx.textAlign = 'right';
    for (let d = 0; d <= maxD + 0.01; d += step) {
      const y = py(d);
      ctx.strokeStyle = theme.grid;
      ctx.setLineDash(d === 0 ? [10, 12] : [4, 10]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 0.75;
      ctx.fillText(`${d} m`, left - 14, y + 9);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  } else {
    ctx.strokeStyle = theme.grid;
    ctx.setLineDash([10, 12]);
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
  ctx.shadowBlur = 10;
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(path);

  if (options.maxMarker) {
    const deepest = pts.reduce((a, b) => (b.depth > a.depth ? b : a));
    const dx = px(deepest.t);
    const dy = py(deepest.depth);
    ctx.fillStyle = theme.text;
    ctx.beginPath();
    ctx.arc(dx, dy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `800 34px ${SYSTEM}`;
    const label = content.depth(deepest.depth);
    const w = ctx.measureText(label).width;
    // Below the dot, or above it when temperature or heart-rate bands follow underneath
    ctx.fillText(label, Math.min(Math.max(dx - w / 2, left), left + width - w), bands.length ? dy - 26 : dy + 52);
  }
  ctx.shadowBlur = 0;

  // Bands
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
    ctx.lineWidth = 4;
    ctx.stroke(line);
    ctx.fillStyle = theme.text;
    ctx.font = `600 24px ${SYSTEM}`;
    ctx.globalAlpha = 0.8;
    const fmt = (v: number) => (band.key === 'temp' ? v.toFixed(0) : String(Math.round(v)));
    ctx.textAlign = 'right';
    ctx.fillText(`${fmt(hi)} ${band.unit}`, left - 14, top + 20);
    ctx.fillText(`${fmt(lo)}`, left - 14, top + bandH);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    top += bandH + bandGap;
  }
}
