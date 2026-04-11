/**
 * OptiPress Compression Worker — WASM-powered
 *
 * Uses jSquash WebAssembly codecs:
 *   - mozjpeg (JPEG encode/decode) — Mozilla's optimized JPEG encoder
 *   - libwebp (WebP encode/decode) — Google's WebP reference
 *   - oxipng (PNG optimize)        — Rust lossless PNG optimizer
 *   - squoosh-resize (lanczos3)    — high-quality resampling
 *
 * Architecture:
 *   - Codecs lazy-loaded via dynamic import — only downloaded when actually used
 *   - Module cache: first compression pays init cost, subsequent jobs reuse instance
 *   - Decode path: jSquash decoder when format matches, OffscreenCanvas fallback
 *     for AVIF/HEIF/unknown formats
 *   - Pipeline: decode → ImageData(RGBA) → optional lanczos3 resize → encode
 *   - Transferable ArrayBuffers on return (zero-copy back to main thread)
 */

import type { CompressionSettings, Effort, WorkerRequest, WorkerResponse } from '../types';

// ─────────────────────────────────────────────────────────────
// Codec module cache — each import() is memoized by the module system,
// but we also cache the resolved function to skip the property lookup.
// ─────────────────────────────────────────────────────────────

type EncodeFn<T = unknown> = (data: ImageData, opts?: T) => Promise<ArrayBuffer>;
type DecodeFn = (buf: ArrayBuffer) => Promise<ImageData>;

const codecCache: {
  avifEncode?: EncodeFn;
  jpegEncode?: EncodeFn;
  jpegDecode?: DecodeFn;
  webpEncode?: EncodeFn;
  webpDecode?: DecodeFn;
  pngEncode?: EncodeFn;
  pngDecode?: DecodeFn;
  oxipng?: (buf: ArrayBuffer, opts?: { level?: number; interlace?: boolean }) => Promise<ArrayBuffer>;
  resize?: (data: ImageData, opts: {
    width: number;
    height: number;
    method?: 'triangle' | 'catrom' | 'mitchell' | 'lanczos3' | 'hqx';
    fitMethod?: 'stretch' | 'contain';
    premultiply?: boolean;
    linearRGB?: boolean;
  }) => Promise<ImageData>;
} = {};

async function getAvifEncoder(): Promise<EncodeFn> {
  if (!codecCache.avifEncode) {
    const mod = await import('@jsquash/avif/encode');
    codecCache.avifEncode = mod.default as EncodeFn;
  }
  return codecCache.avifEncode;
}

async function getJpegEncoder(): Promise<EncodeFn> {
  if (!codecCache.jpegEncode) {
    const mod = await import('@jsquash/jpeg/encode');
    codecCache.jpegEncode = mod.default as EncodeFn;
  }
  return codecCache.jpegEncode;
}

async function getJpegDecoder(): Promise<DecodeFn> {
  if (!codecCache.jpegDecode) {
    const mod = await import('@jsquash/jpeg/decode');
    codecCache.jpegDecode = mod.default as DecodeFn;
  }
  return codecCache.jpegDecode;
}

async function getWebpEncoder(): Promise<EncodeFn> {
  if (!codecCache.webpEncode) {
    const mod = await import('@jsquash/webp/encode');
    codecCache.webpEncode = mod.default as EncodeFn;
  }
  return codecCache.webpEncode;
}

async function getWebpDecoder(): Promise<DecodeFn> {
  if (!codecCache.webpDecode) {
    const mod = await import('@jsquash/webp/decode');
    codecCache.webpDecode = mod.default as DecodeFn;
  }
  return codecCache.webpDecode;
}

async function getPngEncoder(): Promise<EncodeFn> {
  if (!codecCache.pngEncode) {
    const mod = await import('@jsquash/png/encode');
    codecCache.pngEncode = mod.default as EncodeFn;
  }
  return codecCache.pngEncode;
}

async function getPngDecoder(): Promise<DecodeFn> {
  if (!codecCache.pngDecode) {
    const mod = await import('@jsquash/png/decode');
    codecCache.pngDecode = mod.default as DecodeFn;
  }
  return codecCache.pngDecode;
}

async function getOxipng() {
  if (!codecCache.oxipng) {
    const mod = await import('@jsquash/oxipng/optimise');
    codecCache.oxipng = mod.default as unknown as NonNullable<typeof codecCache.oxipng>;
  }
  return codecCache.oxipng!;
}

async function getResize() {
  if (!codecCache.resize) {
    const mod = await import('@jsquash/resize');
    codecCache.resize = mod.default as unknown as NonNullable<typeof codecCache.resize>;
  }
  return codecCache.resize!;
}

// ─────────────────────────────────────────────────────────────
// Decode: prefer jSquash decoders, fall back to OffscreenCanvas
// for formats we don't have a WASM decoder for (AVIF, HEIF, etc.)
// ─────────────────────────────────────────────────────────────

async function decodeToImageData(buffer: ArrayBuffer, mime: string): Promise<ImageData> {
  try {
    if (mime === 'image/jpeg') {
      const decode = await getJpegDecoder();
      return await decode(buffer);
    }
    if (mime === 'image/png') {
      const decode = await getPngDecoder();
      return await decode(buffer);
    }
    if (mime === 'image/webp') {
      const decode = await getWebpDecoder();
      return await decode(buffer);
    }
  } catch (err) {
    // jSquash decoder failed (corrupt file, unsupported variant) — fall through
    console.warn('[worker] jSquash decode failed, falling back to canvas:', err);
  }

  // Canvas fallback — supports anything the browser can render (AVIF, HEIF, BMP, etc.)
  const blob = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return imageData;
}

// ─────────────────────────────────────────────────────────────
// Resize via squoosh-resize (lanczos3 — higher quality than canvas bilinear)
// ─────────────────────────────────────────────────────────────

async function maybeResize(imageData: ImageData, maxWidth: number | null): Promise<ImageData> {
  if (!maxWidth || imageData.width <= maxWidth) return imageData;
  const newHeight = Math.round((imageData.height * maxWidth) / imageData.width);
  const resize = await getResize();
  return resize(imageData, {
    width: maxWidth,
    height: newHeight,
    method: 'lanczos3',
    fitMethod: 'stretch',
    premultiply: true,
    linearRGB: true,
  });
}

function isExifApp1Segment(segment: Uint8Array): boolean {
  return (
    segment.length >= 10 &&
    segment[0] === 0xFF &&
    segment[1] === 0xE1 &&
    segment[4] === 0x45 &&
    segment[5] === 0x78 &&
    segment[6] === 0x69 &&
    segment[7] === 0x66 &&
    segment[8] === 0x00 &&
    segment[9] === 0x00
  );
}

function readUint16(view: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? view[offset] | (view[offset + 1] << 8)
    : (view[offset] << 8) | view[offset + 1];
}

function readUint32(view: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? ((view[offset]) | (view[offset + 1] << 8) | (view[offset + 2] << 16) | (view[offset + 3] << 24)) >>> 0
    : (((view[offset] << 24) >>> 0) | (view[offset + 1] << 16) | (view[offset + 2] << 8) | view[offset + 3]) >>> 0;
}

function writeUint16(view: Uint8Array, offset: number, value: number, littleEndian: boolean): void {
  if (littleEndian) {
    view[offset] = value & 0xFF;
    view[offset + 1] = (value >> 8) & 0xFF;
    return;
  }

  view[offset] = (value >> 8) & 0xFF;
  view[offset + 1] = value & 0xFF;
}

function normalizeJpegExifOrientation(segment: Uint8Array): Uint8Array {
  const copy = segment.slice();
  if (!isExifApp1Segment(copy)) return copy;

  const tiffStart = 10;
  if (copy.length < tiffStart + 8) return copy;

  const littleEndian = copy[tiffStart] === 0x49 && copy[tiffStart + 1] === 0x49;
  const bigEndian = copy[tiffStart] === 0x4D && copy[tiffStart + 1] === 0x4D;
  if (!littleEndian && !bigEndian) return copy;

  const ifd0Offset = readUint32(copy, tiffStart + 4, littleEndian);
  const ifd0Start = tiffStart + ifd0Offset;
  if (ifd0Start + 2 > copy.length) return copy;

  const entryCount = readUint16(copy, ifd0Start, littleEndian);
  for (let index = 0; index < entryCount; index++) {
    const entryOffset = ifd0Start + 2 + (index * 12);
    if (entryOffset + 12 > copy.length) return copy;

    const tag = readUint16(copy, entryOffset, littleEndian);
    if (tag !== 0x0112) continue;

    const type = readUint16(copy, entryOffset + 2, littleEndian);
    const count = readUint32(copy, entryOffset + 4, littleEndian);
    if (type === 3 && count >= 1) {
      writeUint16(copy, entryOffset + 8, 1, littleEndian);
      writeUint16(copy, entryOffset + 10, 0, littleEndian);
    }
    return copy;
  }

  return copy;
}

function collectJpegMetadataSegments(buffer: ArrayBuffer): Uint8Array[] {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return [];

  const metadata: Uint8Array[] = [];
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xFF) break;
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xFF) offset++;
    if (offset + 3 >= bytes.length) break;

    const marker = bytes[offset + 1];
    if (marker === 0xDA || marker === 0xD9) break;

    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
      offset += 2;
      continue;
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;

    if (marker === 0xE1 || marker === 0xED) {
      const segment = bytes.slice(offset, offset + 2 + length);
      metadata.push(marker === 0xE1 ? normalizeJpegExifOrientation(segment) : segment);
    }

    offset += 2 + length;
  }

  return metadata;
}

function findJpegMetadataInsertOffset(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return 0;

  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xFF) {
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xFF) offset++;
    if (offset + 3 >= bytes.length) break;

    const marker = bytes[offset + 1];
    if (marker === 0xDA || marker === 0xD9) break;

    if ((marker >= 0xE0 && marker <= 0xEF) || marker === 0xFE) {
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) break;
      offset += 2 + length;
      continue;
    }

    break;
  }

  return offset;
}

function injectJpegMetadata(buffer: ArrayBuffer, metadata: Uint8Array[]): ArrayBuffer {
  if (metadata.length === 0) return buffer;

  const bytes = new Uint8Array(buffer);
  const insertOffset = findJpegMetadataInsertOffset(bytes);
  if (insertOffset <= 0) return buffer;

  const metadataLength = metadata.reduce((sum, segment) => sum + segment.length, 0);
  const merged = new Uint8Array(bytes.length + metadataLength);
  merged.set(bytes.subarray(0, insertOffset), 0);

  let offset = insertOffset;
  for (const segment of metadata) {
    merged.set(segment, offset);
    offset += segment.length;
  }

  merged.set(bytes.subarray(insertOffset), offset);
  return merged.buffer;
}

function applyMetadataPolicy(
  originalBuffer: ArrayBuffer,
  compressedBuffer: ArrayBuffer,
  originalFormat: string,
  outputFormat: string,
  stripMetadata: boolean
): ArrayBuffer {
  if (stripMetadata) return compressedBuffer;
  if (originalFormat !== 'image/jpeg' || outputFormat !== 'image/jpeg') return compressedBuffer;

  const metadata = collectJpegMetadataSegments(originalBuffer);
  return injectJpegMetadata(compressedBuffer, metadata);
}

async function resizeForSsim(imageData: ImageData, maxDimension: number): Promise<ImageData> {
  const largestSide = Math.max(imageData.width, imageData.height);
  if (largestSide <= maxDimension) return imageData;

  const scale = maxDimension / largestSide;
  const width = Math.max(1, Math.round(imageData.width * scale));
  const height = Math.max(1, Math.round(imageData.height * scale));
  const resize = await getResize();

  return resize(imageData, {
    width,
    height,
    method: 'lanczos3',
    fitMethod: 'stretch',
    premultiply: true,
    linearRGB: true,
  });
}

async function matchImageDataSize(imageData: ImageData, width: number, height: number): Promise<ImageData> {
  if (imageData.width === width && imageData.height === height) return imageData;
  const resize = await getResize();
  return resize(imageData, {
    width,
    height,
    method: 'lanczos3',
    fitMethod: 'stretch',
    premultiply: true,
    linearRGB: true,
  });
}

function luminanceAt(data: Uint8ClampedArray, offset: number): number {
  return (0.2126 * data[offset]) + (0.7152 * data[offset + 1]) + (0.0722 * data[offset + 2]);
}

function computeWindowSsim(reference: ImageData, candidate: ImageData, startX: number, startY: number, windowSize: number): number {
  const ref = reference.data;
  const cmp = candidate.data;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  let samples = 0;

  const endX = Math.min(reference.width, startX + windowSize);
  const endY = Math.min(reference.height, startY + windowSize);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const offset = ((y * reference.width) + x) * 4;
      const lx = luminanceAt(ref, offset);
      const ly = luminanceAt(cmp, offset);

      sumX += lx;
      sumY += ly;
      sumXX += lx * lx;
      sumYY += ly * ly;
      sumXY += lx * ly;
      samples += 1;
    }
  }

  if (samples === 0) return 1;

  const meanX = sumX / samples;
  const meanY = sumY / samples;
  const varianceX = Math.max(0, (sumXX / samples) - (meanX * meanX));
  const varianceY = Math.max(0, (sumYY / samples) - (meanY * meanY));
  const covariance = (sumXY / samples) - (meanX * meanY);

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;

  return ((2 * meanX * meanY) + c1) * ((2 * covariance) + c2)
    / (((meanX * meanX) + (meanY * meanY) + c1) * (varianceX + varianceY + c2));
}

async function computeSsimScore(reference: ImageData, candidate: ImageData): Promise<number> {
  const resizedReference = await resizeForSsim(reference, 256);
  const matchedCandidate = await matchImageDataSize(candidate, resizedReference.width, resizedReference.height);
  const resizedCandidate = await resizeForSsim(matchedCandidate, 256);

  const windowSize = 8;
  let total = 0;
  let windows = 0;

  for (let y = 0; y < resizedReference.height; y += windowSize) {
    for (let x = 0; x < resizedReference.width; x += windowSize) {
      total += computeWindowSsim(resizedReference, resizedCandidate, x, y, windowSize);
      windows += 1;
    }
  }

  if (windows === 0) return 1;
  return Math.max(0, Math.min(1, total / windows));
}

// ─────────────────────────────────────────────────────────────
// Encoder option presets keyed by effort
// Each tier trades encoding time for better compression ratios
// ─────────────────────────────────────────────────────────────

function jpegOptions(quality: number, effort: Effort) {
  // mozjpeg tuning — trellis quantization is the main size/speed lever
  const base = {
    quality,
    baseline: false,
    arithmetic: false,
    progressive: true,
    optimize_coding: true,
    smoothing: 0,
    color_space: 3, // YCbCr
    quant_table: 3, // ImageMagick-tuned table
    trellis_multipass: false,
    trellis_opt_zero: false,
    trellis_opt_table: false,
    trellis_loops: 1,
    auto_subsample: true,
    chroma_subsample: 2, // 4:2:0
    separate_chroma_quality: false,
    chroma_quality: quality,
  };

  if (effort === 'fast') {
    return { ...base, progressive: false, trellis_multipass: false };
  }
  if (effort === 'best') {
    return {
      ...base,
      trellis_multipass: true,
      trellis_opt_zero: true,
      trellis_opt_table: true,
      trellis_loops: 2,
    };
  }
  return base; // balanced
}

function webpOptions(quality: number, effort: Effort, lossless: boolean) {
  // libwebp: method 0 (fastest) → 6 (slowest/smallest)
  const methodByEffort: Record<Effort, number> = {
    fast: 2,
    balanced: 4,
    best: 6,
  };
  return {
    quality: lossless ? 100 : quality,
    target_size: 0,
    target_PSNR: 0,
    method: methodByEffort[effort],
    sns_strength: 50,
    filter_strength: 60,
    filter_sharpness: 0,
    filter_type: 1,
    partitions: 0,
    segments: 4,
    pass: effort === 'best' ? 10 : 1,
    show_compressed: 0,
    preprocessing: 0,
    autofilter: 0,
    partition_limit: 0,
    alpha_compression: 1,
    alpha_filtering: 1,
    alpha_quality: 100,
    lossless: lossless ? 1 : 0,
    exact: lossless ? 1 : 0,
    image_hint: 0,
    emulate_jpeg_size: 0,
    thread_level: 0,
    low_memory: 0,
    near_lossless: 100,
    use_delta_palette: 0,
    use_sharp_yuv: effort === 'best' ? 1 : 0,
  };
}

function avifOptions(quality: number, effort: Effort) {
  const speedByEffort: Record<Effort, number> = {
    fast: 8,
    balanced: 6,
    best: 4,
  };

  return {
    cqLevel: Math.max(0, Math.min(63, Math.round(((100 - quality) / 100) * 63))),
    speed: speedByEffort[effort],
  };
}

function oxipngLevel(effort: Effort): number {
  // oxipng level 1 (fast) → 6 (best)
  return effort === 'fast' ? 1 : effort === 'best' ? 6 : 3;
}

// ─────────────────────────────────────────────────────────────
// Main encode dispatch
// ─────────────────────────────────────────────────────────────

function resolveOutputMime(settings: CompressionSettings, originalFormat: string): string {
  switch (settings.outputFormat) {
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'png':  return 'image/png';
    case 'avif': return 'image/avif';
    case 'original':
      // Only return formats we can actually encode; otherwise default to webp
      if (['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(originalFormat)) {
        return originalFormat;
      }
      return 'image/webp';
    default:
      return 'image/webp';
  }
}

async function encodeImageData(
  imageData: ImageData,
  mime: string,
  settings: CompressionSettings
): Promise<ArrayBuffer> {
  if (mime === 'image/jpeg') {
    const encode = await getJpegEncoder();
    return encode(imageData, jpegOptions(settings.quality, settings.effort));
  }

  if (mime === 'image/webp') {
    const encode = await getWebpEncoder();
    return encode(imageData, webpOptions(settings.quality, settings.effort, settings.webpLossless));
  }

  if (mime === 'image/avif') {
    const encode = await getAvifEncoder();
    return encode(imageData, avifOptions(settings.quality, settings.effort));
  }

  if (mime === 'image/png') {
    // Two-stage: lossless PNG encode → oxipng optimization pass
    const encode = await getPngEncoder();
    const rawPng = await encode(imageData);
    const optimise = await getOxipng();
    return optimise(rawPng, {
      level: oxipngLevel(settings.effort),
      interlace: false,
    });
  }

  throw new Error(`Unsupported output format: ${mime}`);
}

// ─────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, jobId, buffer, originalFormat, settings } = event.data;
  if (type !== 'compress') return;

  const t0 = performance.now();

  const post = (r: WorkerResponse, transfer?: Transferable[]) => {
    if (transfer) self.postMessage(r, { transfer });
    else self.postMessage(r);
  };

  try {
    post({ type: 'progress', jobId, progress: 5 });

    const imageData = await decodeToImageData(buffer, originalFormat);
    post({ type: 'progress', jobId, progress: 30 });

    const resized = await maybeResize(imageData, settings.maxWidth);
    post({ type: 'progress', jobId, progress: 55 });

    const targetMime = resolveOutputMime(settings, originalFormat);
    const encoded = await encodeImageData(resized, targetMime, settings);
    const compressed = applyMetadataPolicy(buffer, encoded, originalFormat, targetMime, settings.stripMetadata);
    post({ type: 'progress', jobId, progress: 80 });

    const compressedImageData = await decodeToImageData(compressed, targetMime);
    const ssimScore = await computeSsimScore(resized, compressedImageData);
    post({ type: 'progress', jobId, progress: 95 });

    const durationMs = Math.round(performance.now() - t0);

    const response: WorkerResponse = {
      type: 'done',
      jobId,
      compressedBuffer: compressed,
      compressedSize: compressed.byteLength,
      compressedFormat: targetMime,
      ssimScore,
      durationMs,
    };

    post(response, [compressed]);
  } catch (err) {
    const response: WorkerResponse = {
      type: 'error',
      jobId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : 'Unknown compression error',
    };
    post(response);
  }
};

// Signal ready for main-thread pool bookkeeping
self.postMessage({ type: 'ready', jobId: '' } as WorkerResponse);

export {};
