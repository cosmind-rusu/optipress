import { useState } from 'react';
import { Download, Package, Loader2 } from 'lucide-react';
import type { ImageJob } from '../types';
import { buildZip, triggerDownload, triggerBlobDownload } from '../lib/zip';
import { formatExtension } from '../lib/formats';

interface DownloadButtonProps {
  jobs: ImageJob[];
}

export default function DownloadButton({ jobs }: DownloadButtonProps) {
  const [loading, setLoading] = useState(false);
  const done = jobs.filter(j => j.status === 'done' && j.compressedBuffer);
  const disabled = done.length === 0 || loading;

  const handleDownload = async () => {
    if (disabled) return;
    setLoading(true);

    try {
      if (done.length === 1) {
        const job = done[0];
        if (!job.compressedBuffer) return;
        const ext = formatExtension(job.compressedFormat ?? job.originalFormat);
        const baseName = job.file.name.replace(/\.[^.]+$/, '');
        triggerBlobDownload(
          job.compressedBuffer,
          job.compressedFormat ?? 'application/octet-stream',
          `${baseName}_optimized${ext}`
        );
      } else {
        await new Promise(r => setTimeout(r, 50));
        const zipData = buildZip(done);
        triggerDownload(zipData, `optipress_${done.length}_images.zip`);
      }
    } finally {
      setLoading(false);
    }
  };

  const label = done.length === 0
    ? 'No images ready'
    : done.length === 1
      ? 'Download image'
      : `Download ZIP · ${done.length}`;

  const Icon = loading ? Loader2 : done.length > 1 ? Package : Download;

  return (
    <button
      onClick={handleDownload}
      disabled={disabled}
      className={`
        group inline-flex items-center gap-2 pl-4 pr-5 h-10 rounded-md font-display font-semibold text-[14px]
        transition-all duration-150 outline-none
        ${disabled
          ? 'bg-[var(--color-bg-muted)] text-[var(--color-text-muted)] cursor-not-allowed border border-[var(--color-border)]'
          : 'bg-[var(--color-bg-dark)] text-white hover:bg-black border border-[var(--color-bg-deep)] active:scale-[0.98]'
        }
      `}
      style={{
        boxShadow: disabled ? 'none' : 'var(--shadow-whisper)',
      }}
    >
      <Icon
        size={15}
        strokeWidth={2.5}
        className={loading ? 'animate-spin' : 'transition-transform group-hover:translate-y-px'}
      />
      <span>{loading ? 'Packaging…' : label}</span>
    </button>
  );
}
