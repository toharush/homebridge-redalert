// Draws the alert card with @napi-rs/canvas. Runs inside the render worker, so
// none of the synchronous draw calls below ever run on the plugin's main thread.
//
// The canvas types are declared structurally instead of imported: the package is
// an optional dependency, and the plugin must still build where it isn't installed.
import * as path from 'path';
import {
  BASE_H, BASE_W, COLORS, FOOTER, FOOTER_TEXT, LIST, PANEL, PANEL_GAP, SUBTITLE, TEXT_RIGHT, TITLE,
  CardData, CardModel, CityLocator, CityPoint, Measure, Projection,
  buildCardModel, buildProjection, chooseListLayout, fitText, moreLabel, readableAccent,
} from './alertCard';

interface Ctx {
  fillStyle: unknown;
  font: string;
  direction: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: unknown, x: number, y: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): {
    addColorStop(offset: number, color: string): void;
  };
  strokeStyle: unknown;
  lineWidth: number;
}

interface Canvas {
  getContext(type: '2d'): Ctx;
  encode(format: 'jpeg', quality: number): Promise<Buffer>;
}

export interface CanvasLib {
  createCanvas(width: number, height: number): Canvas;
  GlobalFonts: { registerFromPath(file: string, family: string): unknown };
}

const FONT_STACK = 'RedAlertHebrew, RedAlertLatin';
const JPEG_QUALITY = 75;
const BASE_CACHE_SIZE = 4;
const GLOW_RADIUS = 32;
const DOT_RADIUS = 7;
// Big salvos: smaller dots so the outlines don't merge into a white blob.
const DENSE_POINTS = 30;
const DENSE_DOT_RADIUS = 4;
// 1920x1080. Bigger requests get a smaller picture of the same shape: each cached
// base costs 4 bytes per pixel, which adds up on a Raspberry Pi.
const MAX_PIXELS = 1920 * 1080;

/**
 * Registers the bundled fonts. The Hebrew files have no digits or Latin, so the
 * stack falls through to Noto Sans for "12:34:56" and the footer.
 */
export function registerFonts(lib: CanvasLib, fontsDir: string): void {
  for (const f of ['NotoSansHebrew-Bold.ttf', 'NotoSansHebrew-Regular.ttf']) {
    lib.GlobalFonts.registerFromPath(path.join(fontsDir, f), 'RedAlertHebrew');
  }
  for (const f of ['NotoSans-Bold.ttf', 'NotoSans-Regular.ttf']) {
    lib.GlobalFonts.registerFromPath(path.join(fontsDir, f), 'RedAlertLatin');
  }
}

function font(size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`;
}

/** Converts #RRGGBB to rgba() so the glow can fade out. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface Frame {
  scale: number;
  dx: number;
  dy: number;
}

export class CardPainter {
  private readonly projection: Projection;
  private readonly locator: CityLocator;
  private readonly panelLeft: number;
  private readonly textLeft: number;
  /** Background, map dots and panel per output size, drawn once and reused. */
  private readonly bases = new Map<string, Canvas>();

  constructor(private readonly lib: CanvasLib, private readonly cities: CityPoint[]) {
    this.projection = buildProjection(cities);
    this.locator = new CityLocator(cities);
    this.panelLeft = Math.round(this.projection.right + PANEL_GAP);
    this.textLeft = this.panelLeft + 40;
  }

  async render(data: CardData, width: number, height: number, quality = JPEG_QUALITY): Promise<Buffer> {
    const [w, h] = outputSize(width, height);
    const canvas = this.lib.createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.base(w, h), 0, 0);
    const f = frame(w, h);
    ctx.setTransform(f.scale, 0, 0, f.scale, f.dx, f.dy);
    this.drawCard(ctx, buildCardModel(data));
    return canvas.encode('jpeg', quality);
  }

  private base(w: number, h: number): Canvas {
    const key = `${w}x${h}`;
    const hit = this.bases.get(key);
    if (hit) {
      return hit;
    }
    const canvas = this.lib.createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);
    const f = frame(w, h);
    ctx.setTransform(f.scale, 0, 0, f.scale, f.dx, f.dy);

    // Every known city as a faint dot traces the shape of the country.
    ctx.fillStyle = COLORS.mapDot;
    for (const c of this.cities) {
      const [x, y] = this.projection.project(c.lat, c.lng);
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = COLORS.panel;
    ctx.beginPath();
    ctx.roundRect(this.panelLeft, PANEL.top, PANEL.right - this.panelLeft, PANEL.bottom - PANEL.top, PANEL.radius);
    ctx.fill();

    this.bases.set(key, canvas);
    if (this.bases.size > BASE_CACHE_SIZE) {
      this.bases.delete(this.bases.keys().next().value!);
    }
    return canvas;
  }

  private drawCard(ctx: Ctx, model: CardModel): void {
    this.drawHighlights(ctx, model);

    // Accent bar on the panel's right edge, next to the title.
    ctx.fillStyle = model.accent;
    ctx.fillRect(PANEL.right - 12, 70, 12, 120);

    const measure: Measure = (text, size) => {
      ctx.font = font(size, true);
      return ctx.measureText(text).width;
    };
    const measureRegular: Measure = (text, size) => {
      ctx.font = font(size);
      return ctx.measureText(text).width;
    };
    const textWidth = TEXT_RIGHT - this.textLeft;

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';

    const title = fitText(measure, model.title, TITLE.size, TITLE.minSize, textWidth);
    ctx.font = font(title.size, true);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(title.text, TEXT_RIGHT, TITLE.baseline);

    if (model.subtitle) {
      const sub = fitText(measureRegular, model.subtitle, SUBTITLE.size, SUBTITLE.minSize, textWidth);
      ctx.font = font(sub.size);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(sub.text, TEXT_RIGHT, SUBTITLE.baseline);
    }

    if (model.cities.length > 0) {
      this.drawCityList(ctx, model, measureRegular, textWidth);
    }

    // Bottom row: alert time on the right, package name on the left. Both are
    // Latin/digits, so draw them left-to-right.
    ctx.direction = 'ltr';
    if (model.time) {
      ctx.textAlign = 'right';
      ctx.font = font(FOOTER.timeSize);
      ctx.fillStyle = readableAccent(model.accent);
      ctx.fillText(model.time, TEXT_RIGHT, FOOTER.baseline);
    }
    ctx.textAlign = 'left';
    ctx.font = font(FOOTER.footerSize);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(FOOTER_TEXT, this.textLeft, FOOTER.baseline);
  }

  private drawHighlights(ctx: Ctx, model: CardModel): void {
    const points: Array<{ x: number; y: number; color: string }> = [];
    const seen = new Set<string>();
    // Oldest first, so the newest alerts are drawn on top.
    for (let i = model.cities.length - 1; i >= 0; i--) {
      const { name, color } = model.cities[i];
      const c = this.locator.find(name);
      if (c && !seen.has(c.name)) {
        seen.add(c.name);
        const [x, y] = this.projection.project(c.lat, c.lng);
        points.push({ x, y, color });
      }
    }
    if (points.length === 0) {
      return;
    }
    // Soft glow first (a radial gradient is far cheaper than shadowBlur), then the dots on top.
    for (const { x, y, color } of points) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, GLOW_RADIUS);
      g.addColorStop(0, withAlpha(color, 0.6));
      g.addColorStop(0.45, withAlpha(color, 0.35));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, GLOW_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    const dense = points.length > DENSE_POINTS;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = dense ? 1 : 2;
    for (const { x, y, color } of points) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, dense ? DENSE_DOT_RADIUS : DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawCityList(ctx: Ctx, model: CardModel, measure: Measure, textWidth: number): void {
    const layout = chooseListLayout(model.cities.length, model.maxCities);
    const gutter = 28;
    const colWidth = (textWidth - gutter * (layout.columns - 1)) / layout.columns;
    const lines = model.cities.slice(0, layout.shown).map((c) => c.name);
    // Right-to-left reading order: fill the rightmost column top to bottom first.
    const slot = (i: number): [number, number] => {
      const col = Math.floor(i / layout.rows);
      const row = i % layout.rows;
      const x = TEXT_RIGHT - col * (colWidth + gutter);
      const y = LIST.top + row * layout.lineHeight + layout.fontSize;
      return [x, y];
    };
    ctx.fillStyle = COLORS.text;
    lines.forEach((name, i) => {
      const fit = fitText(measure, name, layout.fontSize, Math.round(layout.fontSize * 0.8), colWidth);
      const [x, y] = slot(i);
      ctx.font = font(fit.size);
      ctx.fillText(fit.text, x, y);
    });
    if (layout.more > 0) {
      const [x, y] = slot(lines.length);
      ctx.font = font(layout.fontSize, true);
      ctx.fillStyle = readableAccent(model.accent);
      ctx.fillText(moreLabel(layout.more), x, y);
    }
  }
}

/** The requested size, sanitized: at least 16 px a side, at most MAX_PIXELS, same aspect ratio. */
export function outputSize(width: number, height: number): [number, number] {
  let w = Math.max(16, Math.round(width) || BASE_W);
  let h = Math.max(16, Math.round(height) || BASE_H);
  if (w * h > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.max(16, Math.floor(w * k));
    h = Math.max(16, Math.floor(h * k));
  }
  return [w, h];
}

/** Uniform scale that fits the 16:9 design into any requested size, centered. */
function frame(w: number, h: number): Frame {
  const scale = Math.min(w / BASE_W, h / BASE_H);
  return { scale, dx: (w - BASE_W * scale) / 2, dy: (h - BASE_H * scale) / 2 };
}
