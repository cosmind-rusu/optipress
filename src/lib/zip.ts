import { zipSync } from 'fflate';
import type { ImageJob } from '../types';
import { formatExtension } from './formats';

export function buildZip(jobs: ImageJob[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  for (const job of jobs) {
    if (job.status !== 'done' || !job.compressedBuffer) continue;

    const ext = job.compressedFormat
      ? formatExtension(job.compressedFormat)
      : formatExtension(job.originalFormat);

    const baseName = job.file.name.replace(/\.[^.]+$/, '');
    const filename = `${baseName}_optimized${ext}`;

    // Deduplicate names
    let finalName = filename;
    let counter = 1;
    while (finalName in files) {
      finalName = `${baseName}_optimized_${counter}${ext}`;
      counter++;
    }

    files[finalName] = new Uint8Array(job.compressedBuffer as ArrayBuffer);
  }

  return zipSync(files, { level: 0 }); // No extra compression — images are already compressed
}

export function triggerDownload(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as ArrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function triggerBlobDownload(buffer: ArrayBuffer, mime: string, filename: string): void {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
