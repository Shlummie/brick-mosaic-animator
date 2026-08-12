import type { RenderSettings } from "../shared/types";
import { BRICK_PALETTE, nearestBrickColor, type BrickColor } from "./palette";

interface RenderFrameOptions {
  source: CanvasImageSource;
  canvas: HTMLCanvasElement;
  settings: RenderSettings;
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function adjustChannel(value: number, brightness: number, contrast: number): number {
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  return clampChannel(contrastFactor * (value - 128) + 128 + brightness);
}

function colorKey(color: BrickColor): string {
  return color.rgb.join(",");
}

export class StudRenderer {
  private studImage = new Image();
  private studImageReady: Promise<void>;
  private sampleCanvas = document.createElement("canvas");
  private sampleContext = this.sampleCanvas.getContext("2d", { willReadFrequently: true });
  private tileCache = new Map<string, HTMLCanvasElement>();

  constructor(studUrl: string) {
    this.studImageReady = new Promise((resolve, reject) => {
      this.studImage.onload = () => resolve();
      this.studImage.onerror = () => reject(new Error("Could not load the brick stud texture."));
      this.studImage.src = studUrl;
    });
  }

  async ready(): Promise<void> {
    await this.studImageReady;
  }

  renderFrame({ source, canvas, settings }: RenderFrameOptions): void {
    if (!this.sampleContext || settings.columns <= 0 || settings.rows <= 0) return;

    const outputWidth = settings.columns * settings.studSizePx + (settings.columns - 1) * settings.gapPx;
    const outputHeight = settings.rows * settings.studSizePx + (settings.rows - 1) * settings.gapPx;
    if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
    }

    this.sampleCanvas.width = settings.columns;
    this.sampleCanvas.height = settings.rows;
    this.sampleContext.imageSmoothingEnabled = true;
    this.sampleContext.clearRect(0, 0, settings.columns, settings.rows);
    this.sampleContext.drawImage(source, 0, 0, settings.columns, settings.rows);

    const sourcePixels = this.sampleContext.getImageData(0, 0, settings.columns, settings.rows);
    const paletteGrid = this.quantize(sourcePixels, settings);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e7e9ed";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < settings.rows; y += 1) {
      for (let x = 0; x < settings.columns; x += 1) {
        const color = paletteGrid[y * settings.columns + x];
        const tile = this.getTile(color, settings);
        context.drawImage(
          tile,
          x * (settings.studSizePx + settings.gapPx),
          y * (settings.studSizePx + settings.gapPx)
        );
      }
    }

    if (settings.showStudEdges && settings.gapPx <= 1) {
      this.drawFineEdges(context, settings);
    }
  }

  readRawRgba(canvas: HTMLCanvasElement): ArrayBuffer {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable.");
    return context.getImageData(0, 0, canvas.width, canvas.height).data.buffer.slice(0);
  }

  private quantize(imageData: ImageData, settings: RenderSettings): BrickColor[] {
    if (settings.ditherMode === "floyd-steinberg") {
      return this.floydSteinberg(imageData, settings);
    }

    const output: BrickColor[] = [];
    const data = imageData.data;
    for (let y = 0; y < settings.rows; y += 1) {
      for (let x = 0; x < settings.columns; x += 1) {
        const index = (y * settings.columns + x) * 4;
        const threshold =
          settings.ditherMode === "ordered" ? (BAYER_4[y % 4][x % 4] / 15 - 0.5) * 34 : 0;
        const r = adjustChannel(data[index] + threshold, settings.brightness, settings.contrast);
        const g = adjustChannel(data[index + 1] + threshold, settings.brightness, settings.contrast);
        const b = adjustChannel(data[index + 2] + threshold, settings.brightness, settings.contrast);
        output.push(nearestBrickColor(r, g, b));
      }
    }
    return output;
  }

  private floydSteinberg(imageData: ImageData, settings: RenderSettings): BrickColor[] {
    const data = imageData.data;
    const width = settings.columns;
    const height = settings.rows;
    const work = new Float32Array(width * height * 3);
    const output: BrickColor[] = new Array(width * height);

    for (let i = 0; i < width * height; i += 1) {
      work[i * 3] = adjustChannel(data[i * 4], settings.brightness, settings.contrast);
      work[i * 3 + 1] = adjustChannel(data[i * 4 + 1], settings.brightness, settings.contrast);
      work[i * 3 + 2] = adjustChannel(data[i * 4 + 2], settings.brightness, settings.contrast);
    }

    const distribute = (pixel: number, dr: number, dg: number, db: number, factor: number) => {
      if (pixel < 0 || pixel >= width * height) return;
      work[pixel * 3] += dr * factor;
      work[pixel * 3 + 1] += dg * factor;
      work[pixel * 3 + 2] += db * factor;
    };

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const r = clampChannel(work[pixel * 3]);
        const g = clampChannel(work[pixel * 3 + 1]);
        const b = clampChannel(work[pixel * 3 + 2]);
        const color = nearestBrickColor(r, g, b);
        output[pixel] = color;

        const [cr, cg, cb] = color.rgb;
        const dr = r - cr;
        const dg = g - cg;
        const db = b - cb;
        if (x + 1 < width) distribute(pixel + 1, dr, dg, db, 7 / 16);
        if (x > 0 && y + 1 < height) distribute(pixel + width - 1, dr, dg, db, 3 / 16);
        if (y + 1 < height) distribute(pixel + width, dr, dg, db, 5 / 16);
        if (x + 1 < width && y + 1 < height) distribute(pixel + width + 1, dr, dg, db, 1 / 16);
      }
    }

    return output;
  }

  private getTile(color: BrickColor, settings: RenderSettings): HTMLCanvasElement {
    const key = `${colorKey(color)}:${settings.studSizePx}:${settings.lightingDepth}:${settings.showStudEdges}`;
    const cached = this.tileCache.get(key);
    if (cached) return cached;

    if (this.tileCache.size > BRICK_PALETTE.length * 80) {
      this.tileCache.clear();
    }

    const canvas = document.createElement("canvas");
    canvas.width = settings.studSizePx;
    canvas.height = settings.studSizePx;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return canvas;

    context.drawImage(this.studImage, 0, 0, settings.studSizePx, settings.studSizePx);
    const image = context.getImageData(0, 0, settings.studSizePx, settings.studSizePx);
    const data = image.data;
    const [baseR, baseG, baseB] = color.rgb;
    const depth = settings.lightingDepth / 100;

    for (let i = 0; i < data.length; i += 4) {
      const luminance = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      const shade = 1 + (luminance - 0.76) * depth * 2.1;
      data[i] = clampChannel(baseR * shade);
      data[i + 1] = clampChannel(baseG * shade);
      data[i + 2] = clampChannel(baseB * shade);
      data[i + 3] = 255;
    }

    context.putImageData(image, 0, 0);
    if (settings.showStudEdges) {
      context.strokeStyle = "rgba(0, 0, 0, 0.2)";
      context.lineWidth = Math.max(1, settings.studSizePx / 18);
      context.strokeRect(0.5, 0.5, settings.studSizePx - 1, settings.studSizePx - 1);
    }

    this.tileCache.set(key, canvas);
    return canvas;
  }

  private drawFineEdges(context: CanvasRenderingContext2D, settings: RenderSettings): void {
    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.lineWidth = 1;
    for (let x = 0; x <= settings.columns; x += 1) {
      const px = x * (settings.studSizePx + settings.gapPx) - 0.5;
      context.beginPath();
      context.moveTo(px, 0);
      context.lineTo(px, context.canvas.height);
      context.stroke();
    }
    for (let y = 0; y <= settings.rows; y += 1) {
      const py = y * (settings.studSizePx + settings.gapPx) - 0.5;
      context.beginPath();
      context.moveTo(0, py);
      context.lineTo(context.canvas.width, py);
      context.stroke();
    }
    context.restore();
  }
}
