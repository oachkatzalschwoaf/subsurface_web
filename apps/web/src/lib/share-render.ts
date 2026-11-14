/**
 * Renders a share image (like the activity images of fitness apps) onto a canvas: depth profile
 * plus key numbers in blue tones, on a transparent background, an ocean gradient or a photo.
 */
import type { Point } from './dive-data.ts';

export type ShareFormat = 'portrait' | 'square' | 'story';
export type ShareBackground = 'transparent' | 'ocean' | 'photo';

export const SIZES: Record<ShareFormat, [number, number]> = {
  portrait: [1080, 1350],
  square: [1080, 1080],
  story: [1080, 1920],
};

export interface ShareContent {
  points: Point[];
  title: string;
  subtitle: string;
  stats: { label: string; value: string }[];
  /** e.g. "14,9 m" next to the deepest point */
  maxDepthLabel: string;
  footer: string;
}

export interface ShareStyle {
  format: ShareFormat;
  background: ShareBackground;
  photo: ImageBitmap | null;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 24 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  return s;
}

export function renderShare(canvas: HTMLCanvasElement, content: ShareContent, style: ShareStyle): void {
  const [W, H] = SIZES[style.format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);

  // Background
  if (style.background === 'ocean') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e6a9c');
    g.addColorStop(0.55, '#063c5c');
    g.addColorStop(1, '#021a2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (style.background === 'photo' && style.photo) {
    const img = style.photo;
    const scale = Math.max(W / img.width, H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    // Darken top and bottom so white text stays readable on any photo
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(2,20,35,0.55)');
    g.addColorStop(0.3, 'rgba(2,20,35,0)');
    g.addColorStop(0.5, 'rgba(2,20,35,0)');
    g.addColorStop(1, 'rgba(2,20,35,0.8)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = 72;
  const innerW = W - 2 * pad;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 20, 40, 0.45)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffffff';

  // Title and subtitle
  let y = pad;
  if (content.title) {
    const size = fitFont(ctx, content.title, 800, 72, innerW);
    y += size;
    ctx.fillText(content.title, pad, y);
  }
  if (content.subtitle) {
    const size = fitFont(ctx, content.subtitle, 500, 38, innerW);
    y += size + 16;
    ctx.globalAlpha = 0.85;
    ctx.fillText(content.subtitle, pad, y);
    ctx.globalAlpha = 1;
  }

  // Bottom: footer, profile, stats (from the bottom up)
  const footerY = H - pad;
  const profileH = Math.round(H * (style.format === 'square' ? 0.3 : 0.28));
  const profileBottom = footerY - 56;
  const profileTop = profileBottom - profileH;
  const statsValueY = profileTop - 70;
  const statsLabelY = statsValueY - 84;

  if (content.footer) {
    ctx.font = `600 28px ${FONT}`;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'right';
    ctx.fillText(content.footer, W - pad, footerY);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  const columns = content.stats.length || 1;
  const colW = innerW / columns;
  content.stats.forEach((stat, i) => {
    const cx = pad + i * colW;
    ctx.font = `700 26px ${FONT}`;
    ctx.globalAlpha = 0.75;
    ctx.fillText(stat.label.toUpperCase(), cx, statsLabelY);
    ctx.globalAlpha = 1;
    fitFont(ctx, stat.value, 800, 76, colW - 16);
    ctx.fillText(stat.value, cx, statsValueY);
  });

  // Profile
  const pts = content.points;
  if (pts.length > 1) {
    const maxT = Math.max(pts.at(-1)!.t, 1);
    const maxD = Math.max(...pts.map((p) => p.depth), 1);
    const px = (t: number) => pad + (t / maxT) * innerW;
    const py = (d: number) => profileTop + (d / maxD) * profileH;

    ctx.shadowBlur = 0;
    // surface line
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(pad, profileTop);
    ctx.lineTo(pad + innerW, profileTop);
    ctx.stroke();
    ctx.setLineDash([]);

    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(px(p.t), py(p.depth)) : path.moveTo(px(p.t), py(p.depth))));
    const area = new Path2D(path);
    area.lineTo(px(pts.at(-1)!.t), profileTop);
    area.lineTo(px(pts[0]!.t), profileTop);
    area.closePath();

    const fill = ctx.createLinearGradient(0, profileTop, 0, profileBottom);
    fill.addColorStop(0, 'rgba(120, 200, 245, 0.65)');
    fill.addColorStop(1, 'rgba(40, 120, 200, 0.12)');
    ctx.fillStyle = fill;
    ctx.fill(area);

    ctx.shadowColor = 'rgba(0, 20, 40, 0.5)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#c8ecff';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(path);

    // deepest point
    const deepest = pts.reduce((a, b) => (b.depth > a.depth ? b : a));
    const dx = px(deepest.t);
    const dy = py(deepest.depth);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(dx, dy, 10, 0, Math.PI * 2);
    ctx.fill();
    if (content.maxDepthLabel) {
      ctx.font = `700 32px ${FONT}`;
      const w = ctx.measureText(content.maxDepthLabel).width;
      const lx = Math.min(Math.max(dx - w / 2, pad), pad + innerW - w);
      ctx.fillText(content.maxDepthLabel, lx, Math.min(dy + 52, profileBottom + 44));
    }
  }
  ctx.shadowBlur = 0;
}
