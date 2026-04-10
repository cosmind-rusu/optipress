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

function webpOptions(quality: number, effort: Effort) {
  // libwebp: method 0 (fastest) → 6 (slowest/smallest)
  const methodByEffort: Record<Effort, number> = {
    fast: 2,
    balanced: 4,
    best: 6,
  };
  return {
    quality,
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
    lossless: 0,
    exact: 0,
    image_hint: 0,
    emulate_jpeg_size: 0,
    thread_level: 0,
    low_memory: 0,
    near_lossless: 100,
    use_delta_palette: 0,
    use_sharp_yuv: effort === 'best' ? 1 : 0,
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
    case 'original':
      // Only return formats we can actually encode; otherwise default to webp
      if (['image/jpeg', 'image/png', 'image/webp'].includes(originalFormat)) {
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
    return encode(imageData, webpOptions(settings.quality, settings.effort));
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

    // 1. Decode to ImageData (RGBA)
    const imageData = await decodeToImageData(buffer, originalFormat);
    post({ type: 'progress', jobId, progress: 30 });

    // 2. Optional resize (lanczos3 via WASM)
    const resized = await maybeResize(imageData, settings.maxWidth);
    post({ type: 'progress', jobId, progress: 55 });

    // 3. Encode via the appropriate WASM codec
    const targetMime = resolveOutputMime(settings, originalFormat);
    const compressed = await encodeImageData(resized, targetMime, settings);
    post({ type: 'progress', jobId, progress: 95 });

    const durationMs = Math.round(performance.now() - t0);

    const response: WorkerResponse = {
      type: 'done',
      jobId,
      compressedBuffer: compressed,
      compressedSize: compressed.byteLength,
      compressedFormat: targetMime,
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
