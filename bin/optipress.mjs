#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const OUTPUT_FORMATS = new Set(['webp', 'jpeg', 'png', 'avif', 'original']);
const EFFORTS = new Set(['fast', 'balanced', 'best']);

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

const settings = {
  outputFormat: 'webp',
  quality: 80,
  maxWidth: null,
  effort: 'balanced',
  webpLossless: false,
};

const options = {
  outDir: 'optipress-output',
  recursive: true,
};

function usage(exitCode = 0) {
  const text = `
Usage:
  optipress <files|dirs|globs...> [options]

Options:
  --out-dir <dir>       Output directory (default: optipress-output)
  --format <format>     webp, jpeg, png, avif, original (default: webp)
  --quality <1-100>     Lossy quality (default: 80)
  --max-width <px>      Resize images wider than this value
  --effort <tier>       fast, balanced, best (default: balanced)
  --lossless-webp       Enable lossless WebP when output format is webp
  --no-recursive        Do not scan directories recursively
  -h, --help            Show this help

Examples:
  optipress ./images --format webp --quality 82
  optipress "./assets/**/*.{jpg,png}" --out-dir ./dist/images --max-width 1600
`;

  console.log(text.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const patterns = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') usage(0);
    if (arg === '--lossless-webp') {
      settings.webpLossless = true;
      continue;
    }
    if (arg === '--no-recursive') {
      options.recursive = false;
      continue;
    }

    if (arg.startsWith('--')) {
      const [flag, inlineValue] = arg.split('=', 2);
      const value = inlineValue ?? argv[++index];
      if (!value) throw new Error(`${flag} needs a value`);

      switch (flag) {
        case '--out-dir':
          options.outDir = value;
          break;
        case '--format':
          if (!OUTPUT_FORMATS.has(value)) throw new Error(`Unsupported format: ${value}`);
          settings.outputFormat = value;
          break;
        case '--quality': {
          const quality = Number(value);
          if (!Number.isFinite(quality) || quality < 1 || quality > 100) throw new Error('Quality must be between 1 and 100');
          settings.quality = Math.round(quality);
          break;
        }
        case '--max-width': {
          const maxWidth = Number(value);
          if (!Number.isFinite(maxWidth) || maxWidth < 1) throw new Error('Max width must be a positive number');
          settings.maxWidth = Math.round(maxWidth);
          break;
        }
        case '--effort':
          if (!EFFORTS.has(value)) throw new Error(`Unsupported effort: ${value}`);
          settings.effort = value;
          break;
        default:
          throw new Error(`Unknown option: ${flag}`);
      }
      continue;
    }

    patterns.push(arg);
  }

  if (patterns.length === 0) usage(1);
  return patterns;
}

function installFileFetch() {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : input?.url ?? input?.href ?? String(input);
    if (!url.startsWith('file:')) return nativeFetch(input);

    const body = await readFile(new URL(url));
    return new Response(body, {
      headers: { 'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
    });
  };
}

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function walkDirectory(dir, recursive) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...await walkDirectory(fullPath, recursive));
    } else if (entry.isFile() && isImagePath(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function globToRegex(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === '*') {
      if (next === '*') {
        source += '.*';
        index++;
      } else {
        source += '[^/\\\\]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/\\\\]';
      continue;
    }

    if (char === '{') {
      const end = pattern.indexOf('}', index);
      if (end !== -1) {
        const choices = pattern.slice(index + 1, end).split(',').map(escapeRegex).join('|');
        source += `(${choices})`;
        index = end;
        continue;
      }
    }

    source += escapeRegex(char);
  }

  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '');
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globBase(pattern) {
  const normalized = path.resolve(pattern);
  const parts = normalized.split(path.sep);
  const wildcardIndex = parts.findIndex(part => /[*?{]/.test(part));

  if (wildcardIndex === -1) return normalized;
  const base = parts.slice(0, Math.max(1, wildcardIndex)).join(path.sep);
  return base || path.parse(normalized).root;
}

async function expandPattern(pattern) {
  const resolved = path.resolve(pattern);

  if (existsSync(resolved)) {
    const info = await stat(resolved);
    if (info.isDirectory()) return walkDirectory(resolved, options.recursive);
    return info.isFile() && isImagePath(resolved) ? [resolved] : [];
  }

  const base = globBase(pattern);
  if (!existsSync(base)) return [];

  const regex = globToRegex(path.resolve(pattern));
  const candidates = await walkDirectory(base, true);
  return candidates.filter(filePath => regex.test(path.resolve(filePath)));
}

async function resolveInputs(patterns) {
  const seen = new Set();
  const files = [];

  for (const pattern of patterns) {
    for (const file of await expandPattern(pattern)) {
      const resolved = path.resolve(file);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        files.push(resolved);
      }
    }
  }

  return files;
}

async function decode(buffer, mime) {
  if (mime === 'image/jpeg') return (await import('@jsquash/jpeg/decode.js')).default(buffer);
  if (mime === 'image/png') return (await import('@jsquash/png/decode.js')).default(buffer);
  if (mime === 'image/webp') return (await import('@jsquash/webp/decode.js')).default(buffer);
  if (mime === 'image/avif') return (await import('@jsquash/avif/decode.js')).default(buffer);
  throw new Error(`Unsupported input format: ${mime}`);
}

async function maybeResize(imageData) {
  if (!settings.maxWidth || imageData.width <= settings.maxWidth) return imageData;

  const resize = (await import('@jsquash/resize/index.js')).default;
  const height = Math.round((imageData.height * settings.maxWidth) / imageData.width);
  return resize(imageData, {
    width: settings.maxWidth,
    height,
    method: 'lanczos3',
    fitMethod: 'stretch',
    premultiply: true,
    linearRGB: true,
  });
}

function jpegOptions() {
  const base = {
    quality: settings.quality,
    baseline: false,
    arithmetic: false,
    progressive: true,
    optimize_coding: true,
    smoothing: 0,
    color_space: 3,
    quant_table: 3,
    trellis_multipass: false,
    trellis_opt_zero: false,
    trellis_opt_table: false,
    trellis_loops: 1,
    auto_subsample: true,
    chroma_subsample: 2,
    separate_chroma_quality: false,
    chroma_quality: settings.quality,
  };

  if (settings.effort === 'fast') return { ...base, progressive: false };
  if (settings.effort === 'best') {
    return { ...base, trellis_multipass: true, trellis_opt_zero: true, trellis_opt_table: true, trellis_loops: 2 };
  }
  return base;
}

function webpOptions() {
  const method = { fast: 2, balanced: 4, best: 6 }[settings.effort];
  return {
    quality: settings.webpLossless ? 100 : settings.quality,
    target_size: 0,
    target_PSNR: 0,
    method,
    sns_strength: 50,
    filter_strength: 60,
    filter_sharpness: 0,
    filter_type: 1,
    partitions: 0,
    segments: 4,
    pass: settings.effort === 'best' ? 10 : 1,
    show_compressed: 0,
    preprocessing: 0,
    autofilter: 0,
    partition_limit: 0,
    alpha_compression: 1,
    alpha_filtering: 1,
    alpha_quality: 100,
    lossless: settings.webpLossless ? 1 : 0,
    exact: settings.webpLossless ? 1 : 0,
    image_hint: 0,
    emulate_jpeg_size: 0,
    thread_level: 0,
    low_memory: 0,
    near_lossless: 100,
    use_delta_palette: 0,
    use_sharp_yuv: settings.effort === 'best' ? 1 : 0,
  };
}

function avifOptions() {
  const speed = { fast: 8, balanced: 6, best: 4 }[settings.effort];
  return {
    cqLevel: Math.max(0, Math.min(63, Math.round(((100 - settings.quality) / 100) * 63))),
    speed,
  };
}

function resolveTargetMime(originalMime) {
  if (settings.outputFormat === 'original') return originalMime;
  if (settings.outputFormat === 'jpeg') return 'image/jpeg';
  if (settings.outputFormat === 'png') return 'image/png';
  if (settings.outputFormat === 'webp') return 'image/webp';
  if (settings.outputFormat === 'avif') return 'image/avif';
  return 'image/webp';
}

async function encode(imageData, mime) {
  if (mime === 'image/jpeg') return (await import('@jsquash/jpeg/encode.js')).default(imageData, jpegOptions());
  if (mime === 'image/webp') return (await import('@jsquash/webp/encode.js')).default(imageData, webpOptions());
  if (mime === 'image/avif') return (await import('@jsquash/avif/encode.js')).default(imageData, avifOptions());
  if (mime === 'image/png') {
    const png = await (await import('@jsquash/png/encode.js')).default(imageData);
    const optimise = (await import('@jsquash/oxipng/optimise.js')).default;
    return optimise(png, { level: settings.effort === 'fast' ? 1 : settings.effort === 'best' ? 6 : 3, interlace: false });
  }
  throw new Error(`Unsupported output format: ${mime}`);
}

function outputPathFor(inputPath, targetMime, usedNames) {
  const extension = EXTENSION_BY_MIME[targetMime] ?? '.img';
  const baseName = path.basename(inputPath, path.extname(inputPath));
  let name = `${baseName}${extension}`;
  let counter = 2;

  while (usedNames.has(name.toLowerCase())) {
    name = `${baseName}-${counter}${extension}`;
    counter++;
  }

  usedNames.add(name.toLowerCase());
  return path.join(options.outDir, name);
}

async function compressFile(inputPath, usedNames) {
  const originalBuffer = await readFile(inputPath);
  const originalMime = MIME_BY_EXTENSION[path.extname(inputPath).toLowerCase()];
  if (!originalMime) throw new Error('Unsupported input format');

  const arrayBuffer = originalBuffer.buffer.slice(
    originalBuffer.byteOffset,
    originalBuffer.byteOffset + originalBuffer.byteLength
  );

  const decoded = await decode(arrayBuffer, originalMime);
  const resized = await maybeResize(decoded);
  const targetMime = resolveTargetMime(originalMime);
  const encoded = await encode(resized, targetMime);
  const outputPath = outputPathFor(inputPath, targetMime, usedNames);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(encoded));

  return {
    inputPath,
    outputPath,
    inputSize: originalBuffer.byteLength,
    outputSize: encoded.byteLength,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  installFileFetch();
  const patterns = parseArgs(process.argv.slice(2));
  options.outDir = path.resolve(options.outDir);
  const files = await resolveInputs(patterns);

  if (files.length === 0) {
    console.error('No supported image files found.');
    process.exit(1);
  }

  const usedNames = new Set();
  const results = [];
  let failures = 0;

  for (const file of files) {
    try {
      const result = await compressFile(file, usedNames);
      results.push(result);
      const delta = result.inputSize - result.outputSize;
      const percent = result.inputSize > 0 ? Math.round((delta / result.inputSize) * 100) : 0;
      console.log(`${path.basename(file)} -> ${path.relative(process.cwd(), result.outputPath)} (${formatBytes(delta)} saved, ${percent}%)`);
    } catch (error) {
      failures++;
      console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const inputTotal = results.reduce((sum, item) => sum + item.inputSize, 0);
  const outputTotal = results.reduce((sum, item) => sum + item.outputSize, 0);
  const saved = inputTotal - outputTotal;
  const percent = inputTotal > 0 ? Math.round((saved / inputTotal) * 100) : 0;

  console.log(`Done: ${results.length} compressed, ${failures} failed, ${formatBytes(saved)} saved (${percent}%).`);
  if (failures > 0) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
