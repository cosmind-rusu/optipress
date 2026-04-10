export function detectFormat(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer.slice(0, 12));

  // JPEG: FF D8 FF
  if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    view[0] === 0x89 && view[1] === 0x50 &&
    view[2] === 0x4E && view[3] === 0x47
  ) {
    return 'image/png';
  }

  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (
    view[0] === 0x52 && view[1] === 0x49 &&
    view[2] === 0x46 && view[3] === 0x46 &&
    view[8] === 0x57 && view[9] === 0x45 &&
    view[10] === 0x42 && view[11] === 0x50
  ) {
    return 'image/webp';
  }

  // ISO-BMFF container (ftyp box). We only accept it as AVIF when the
  // major_brand at bytes 8-11 is 'avif' or 'avis' — otherwise this could be
  // HEIC, HEIF, MP4, MOV, JPEG 2000, etc. and we shouldn't mislabel it.
  if (view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70) {
    const brand = String.fromCharCode(view[8], view[9], view[10], view[11]);
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif';
    }
    return 'unknown';
  }

  return 'unknown';
}

export const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];

export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

export function formatExtension(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    case 'image/avif': return '.avif';
    default: return '';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i]}`;
}

export function mimeLabel(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'JPEG';
    case 'image/png': return 'PNG';
    case 'image/webp': return 'WebP';
    case 'image/avif': return 'AVIF';
    default: return mime.split('/')[1]?.toUpperCase() ?? 'Unknown';
  }
}
