import type { FaceGridMode, FaceGridModel } from '../../shared/contracts';

type FaceBox = { x: number; y: number; width: number; height: number; confidence: number };
type CvMat = { rows: number; cols: number; data32F?: Float32Array; data64F?: Float64Array; delete(): void };
type CvNet = { setInput(blob: CvMat): void; forward(): CvMat; delete?(): void };
type CvRuntime = {
  Mat: new () => CvMat;
  Size: new (width: number, height: number) => unknown;
  Scalar: new (b: number, g: number, r: number, a?: number) => unknown;
  imread(canvas: HTMLCanvasElement): CvMat;
  cvtColor(source: CvMat, target: CvMat, code: number): void;
  blobFromImage(source: CvMat, scale: number, size: unknown, mean: unknown, swapRB: boolean, crop: boolean): CvMat;
  readNetFromCaffe(prototxt: string, model?: string): CvNet;
  FS_createDataFile(parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean): void;
  FS_unlink?(path: string): void;
  COLOR_RGBA2BGR: number;
  exceptionFromPtr?(value: unknown): { msg?: string };
};

let cvPromise: Promise<CvRuntime> | null = null;
let netPromise: Promise<CvNet> | null = null;

export type FaceGridOptions = { mode: FaceGridMode; thickness: number; alpha: number; color: string };
export type FaceGridOutput = { dataUrl: string; faceCount: number; scaled: boolean; mime: string };

async function loadOpenCv(): Promise<CvRuntime> {
  if (!cvPromise) {
    const globalObject = globalThis as typeof globalThis & { Module?: Record<string, unknown> };
    globalObject.Module ??= {};
    // The package intentionally ships the UMD runtime as a subpath; its type
    // declaration describes the loader but not this browser-global subpath.
    // @ts-expect-error -- runtime subpath is provided by opencv-js-wasm.
    cvPromise = import('opencv-js-wasm/opencv.js').then(async (module) => {
      const candidate = (module as unknown as { default?: unknown }).default ?? module;
      return await Promise.resolve(candidate as CvRuntime);
    });
  }
  return cvPromise;
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return new Uint8Array((value as { data: number[] }).data);
  return new Uint8Array();
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = dataUrl;
  });
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

function mapRotatedBox(box: FaceBox, angle: 0 | 90 | 180 | 270, width: number, height: number): FaceBox {
  if (angle === 0) return box;
  if (angle === 90) return { ...box, x: width - (box.y + box.height), y: box.x, width: box.height, height: box.width };
  if (angle === 180) return { ...box, x: width - (box.x + box.width), y: height - (box.y + box.height) };
  return { ...box, x: box.y, y: height - (box.x + box.width), width: box.height, height: box.width };
}

function normalizeBox(box: FaceBox, width: number, height: number): FaceBox | null {
  const x = clamp(Math.round(box.x), 0, width); const y = clamp(Math.round(box.y), 0, height);
  const right = clamp(Math.round(box.x + box.width), 0, width); const bottom = clamp(Math.round(box.y + box.height), 0, height);
  return right > x && bottom > y ? { ...box, x, y, width: right - x, height: bottom - y } : null;
}

function intersectionOverUnion(a: FaceBox, b: FaceBox): number {
  const left = Math.max(a.x, b.x); const top = Math.max(a.y, b.y); const right = Math.min(a.x + a.width, b.x + b.width); const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top); const union = a.width * a.height + b.width * b.height - overlap;
  return union ? overlap / union : 0;
}

function nonMaximumSuppression(boxes: FaceBox[]): FaceBox[] {
  const result: FaceBox[] = [];
  for (const box of [...boxes].sort((a, b) => b.confidence - a.confidence)) {
    if (!result.some((kept) => intersectionOverUnion(kept, box) > 0.3)) result.push(box);
  }
  return result;
}

function createRotatedCanvas(source: HTMLCanvasElement, angle: 0 | 90 | 180 | 270): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = angle === 0 || angle === 180 ? source.width : source.height;
  canvas.height = angle === 0 || angle === 180 ? source.height : source.width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片画布');
  context.save();
  if (angle === 90) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
  else if (angle === 180) { context.translate(canvas.width, canvas.height); context.rotate(Math.PI); }
  else if (angle === 270) { context.translate(0, canvas.height); context.rotate(-Math.PI / 2); }
  context.drawImage(source, 0, 0); context.restore();
  return canvas;
}

async function detectFaces(cv: CvRuntime, source: HTMLCanvasElement, model: FaceGridModel): Promise<FaceBox[]> {
  if (!netPromise) {
    netPromise = Promise.resolve().then(() => {
      const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      const protoPath = `/face-grid-${suffix}.prototxt`;
      const modelPath = `/face-grid-${suffix}.caffemodel`;
      cv.FS_createDataFile('/', protoPath.slice(1), asBytes(model.prototxt), true, false);
      cv.FS_createDataFile('/', modelPath.slice(1), asBytes(model.model), true, false);
      try { return cv.readNetFromCaffe(protoPath, modelPath); }
      finally { cv.FS_unlink?.(protoPath); cv.FS_unlink?.(modelPath); }
    });
  }
  const net = await netPromise; const all: FaceBox[] = [];
  for (const angle of [0, 90, 180, 270] as const) {
    const rotated = createRotatedCanvas(source, angle); const rgba = cv.imread(rotated); const bgr = new cv.Mat();
    try {
      cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR);
      const blob = cv.blobFromImage(bgr, 1, new cv.Size(300, 300), new cv.Scalar(104, 177, 123), false, false);
      try {
        net.setInput(blob); const output = net.forward();
        try {
          const values = output.data32F ?? output.data64F ?? new Float32Array();
          for (let index = 0; index + 6 < values.length; index += 7) {
            const confidence = Number(values[index + 2]); if (confidence < 0.3) continue;
            const candidate = normalizeBox({ x: Number(values[index + 3]) * rotated.width, y: Number(values[index + 4]) * rotated.height, width: (Number(values[index + 5]) - Number(values[index + 3])) * rotated.width, height: (Number(values[index + 6]) - Number(values[index + 4])) * rotated.height, confidence }, rotated.width, rotated.height);
            if (candidate) {
              const mapped = normalizeBox(mapRotatedBox(candidate, angle, source.width, source.height), source.width, source.height);
              if (mapped) all.push(mapped);
            }
          }
        } finally { output.delete(); }
      } finally { blob.delete(); }
    } catch (error) {
      const message = typeof error === 'number' && cv.exceptionFromPtr ? cv.exceptionFromPtr(error)?.msg : error instanceof Error ? error.message : String(error);
      throw new Error(`人脸检测失败：${message || 'OpenCV DNN 错误'}`);
    } finally { rgba.delete(); bgr.delete(); }
  }
  return nonMaximumSuppression(all);
}

function parseColor(value: string): string {
  const text = value.trim().toLowerCase();
  if (['white', 'red', 'blue', 'black'].includes(text)) return text;
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  const parts = text.split(/[,，\s]+/).map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part) && part >= 0 && part <= 255)) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  return 'white';
}

function drawDiamondGrid(context: CanvasRenderingContext2D, face: FaceBox, options: FaceGridOptions): void {
  const step = Math.max(10, Math.floor(face.width / 12)); const lineWidth = Math.max(1, Math.round(options.thickness));
  context.save(); context.beginPath(); context.ellipse(face.x + face.width / 2, face.y + face.height / 2, face.width / 2 * 1.08, face.height / 2 * 1.08, 0, 0, Math.PI * 2); context.clip();
  context.globalAlpha = options.alpha; context.strokeStyle = parseColor(options.color); context.lineWidth = lineWidth; context.lineJoin = 'round';
  for (let y = face.y; y < face.y + face.height; y += step) for (let x = face.x; x < face.x + face.width; x += step) {
    context.beginPath(); context.moveTo(x + step / 2, y); context.lineTo(x + step, y + step / 2); context.lineTo(x + step / 2, y + step); context.lineTo(x, y + step / 2); context.closePath(); context.stroke();
  }
  context.restore();
}

function drawDiagonalLines(context: CanvasRenderingContext2D, x: number, y: number, size: number, options: FaceGridOptions): void {
  const step = Math.max(8, Math.floor(size / 10)); context.save(); context.beginPath(); context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); context.clip();
  context.globalAlpha = options.alpha; context.strokeStyle = parseColor(options.color); context.lineWidth = Math.max(1, Math.round(options.thickness));
  for (let offset = -size; offset < size * 2; offset += step) { context.beginPath(); context.moveTo(x + offset, y); context.lineTo(x + offset + size, y + size); context.stroke(); context.beginPath(); context.moveTo(x + offset + size, y); context.lineTo(x + offset, y + size); context.stroke(); }
  context.restore();
}

function renderResult(source: HTMLCanvasElement, faces: FaceBox[], options: FaceGridOptions): HTMLCanvasElement {
  const context = source.getContext('2d'); if (!context) throw new Error('无法读取图片画布');
  if (options.mode === 'grid' || !faces.length) {
    if (options.mode === 'grid') for (const face of faces) drawDiamondGrid(context, face, options);
    return source;
  }
  const face = [...faces].sort((a, b) => b.width * b.height - a.width * a.height)[0]!; const radius = Math.max(20, Math.floor(Math.min(face.width, face.height) * 0.55));
  const centerX = face.x + face.width / 2; const centerY = face.y + face.height / 2; const left = clamp(Math.round(centerX - radius), 0, source.width); const top = clamp(Math.round(centerY - radius), 0, source.height); const right = clamp(Math.round(centerX + radius), 0, source.width); const bottom = clamp(Math.round(centerY + radius), 0, source.height); const size = Math.min(right - left, bottom - top);
  if (size <= 0) return source;
  const result = document.createElement('canvas'); result.width = source.width; result.height = source.height * 2; const output = result.getContext('2d'); if (!output) throw new Error('无法创建重组画布');
  output.fillStyle = 'white'; output.fillRect(0, 0, result.width, result.height); output.save(); output.beginPath(); output.arc(centerX, centerY, size / 2, 0, Math.PI * 2); output.clip(); output.drawImage(source, 0, 0); output.restore(); drawDiagonalLines(output, left, top, size, options);
  output.drawImage(source, 0, source.height); output.fillStyle = 'white'; output.beginPath(); output.arc(centerX, source.height + centerY, size, 0, Math.PI * 2); output.fill();
  return result;
}

export async function processFaceGrid(dataUrl: string, model: FaceGridModel, options: FaceGridOptions): Promise<FaceGridOutput> {
  const image = await loadImage(dataUrl); const source = document.createElement('canvas'); const scale = Math.min(1, 2500 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height)); source.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale)); source.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const sourceContext = source.getContext('2d'); if (!sourceContext) throw new Error('无法创建图片画布'); sourceContext.drawImage(image, 0, 0, source.width, source.height);
  const cv = await loadOpenCv(); const faces = await detectFaces(cv, source, model); const result = renderResult(source, faces, options); const mime = /^data:(image\/(?:png|jpeg|webp));/i.exec(dataUrl)?.[1]?.toLowerCase() ?? 'image/png';
  let outputMime = mime; let outputData: string;
  try { outputData = result.toDataURL(outputMime, outputMime === 'image/jpeg' ? 0.95 : undefined); } catch { outputMime = 'image/png'; outputData = result.toDataURL(outputMime); }
  const encodedMime = /^data:(image\/(?:png|jpeg|webp));/i.exec(outputData)?.[1]?.toLowerCase();
  return { dataUrl: outputData, faceCount: faces.length, scaled: scale < 1, mime: encodedMime ?? outputMime };
}
