import { useState } from 'react';
import { Check, XCircle, Loader2, ChevronDown, ChevronUp, X, RotateCcw, ImageIcon } from 'lucide-react';
import type { ImageJob } from '../types';
import { formatBytes, mimeLabel } from '../lib/formats';
import BeforeAfterSlider from './BeforeAfterSlider';

interface ImageCardProps {
  job: ImageJob;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  index: number;
}

export default function ImageCard({ job, onRemove, onRetry, index }: ImageCardProps) {
  const [expanded, setExpanded] = useState(false);

  const savings = job.compressedSize && job.originalSize > 0
    ? Math.round(((job.originalSize - job.compressedSize) / job.originalSize) * 100)
    : null;

  const canExpand = job.status === 'done' && job.compressedUrl;

  return (
    <div
      className="bg-white rounded-lg border border-[var(--color-border)] overflow-hidden transition-all duration-150 hover:border-[var(--color-border-strong)]"
      style={{
        boxShadow: 'var(--shadow-whisper)',
        animation: `fadeUp 0.35s cubic-bezier(0.22, 1, 0.36, 1) ${Math.min(index * 30, 300)}ms both`,
      }}
    >
      {/* Main row */}
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Thumbnail */}
        <div className="relative w-12 h-12 shrink-0 rounded-md overflow-hidden bg-[var(--color-bg-muted)] border border-[var(--color-border)]">
          {job.thumbnailUrl ? (
            <img
              src={job.thumbnailUrl}
              alt={job.file.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)]">
              <ImageIcon size={16} />
            </div>
          )}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-[var(--color-text)] truncate" title={job.file.name}>
              {job.file.name}
            </span>
            <span className="shrink-0 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1.5 py-0.5 rounded bg-[var(--color-bg-muted)]">
              {mimeLabel(job.originalFormat)}
            </span>
          </div>

          {/* Status line */}
          <div className="flex items-center gap-2 mt-1">
            {job.status === 'queued' && (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {formatBytes(job.originalSize)} · <span>Queued</span>
              </span>
            )}
            {job.status === 'processing' && (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {formatBytes(job.originalSize)} · <span className="text-[var(--color-action)]">Compressing…</span>
              </span>
            )}
            {job.status === 'done' && job.compressedSize != null && (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                <span className="font-mono">{formatBytes(job.originalSize)}</span>
                <span className="mx-1.5">→</span>
                <span className="font-mono text-[var(--color-text)] font-medium">{formatBytes(job.compressedSize)}</span>
                {savings != null && savings > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-success-subtle)] text-[var(--color-success)] border border-[var(--color-success-border)]">
                    −{savings}%
                  </span>
                )}
                {savings != null && savings <= 0 && (
                  <span className="ml-2 text-[var(--color-text-muted)]">no reduction</span>
                )}
                {job.ssimScore != null && (
                  <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-bg-muted)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                    SSIM {job.ssimScore.toFixed(3)}
                  </span>
                )}
              </span>
            )}
            {job.status === 'error' && (
              <span className="text-[12px] text-[var(--color-danger)] truncate">{job.error}</span>
            )}
          </div>
        </div>

        {/* Status icon */}
        <div className="shrink-0 w-6 h-6 flex items-center justify-center">
          {job.status === 'queued' && (
            <div className="w-4 h-4 rounded-full border border-[var(--color-border-strong)]" />
          )}
          {job.status === 'processing' && (
            <Loader2 size={16} className="text-[var(--color-action)] animate-spin" />
          )}
          {job.status === 'done' && (
            <div className="w-5 h-5 rounded-full bg-[var(--color-success)] flex items-center justify-center">
              <Check size={12} strokeWidth={3} className="text-white" />
            </div>
          )}
          {job.status === 'error' && (
            <XCircle size={18} className="text-[var(--color-danger)]" />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {job.status === 'error' && (
            <button
              onClick={() => onRetry(job.id)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-action)] hover:bg-[var(--color-action-subtle)] transition-colors"
              title="Retry"
            >
              <RotateCcw size={13} />
            </button>
          )}
          {canExpand && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] transition-colors"
              title={expanded ? 'Collapse' : 'Compare'}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button
            onClick={() => onRemove(job.id)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-subtle)] transition-colors"
            title="Remove"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar — thin, at bottom */}
      {job.status === 'processing' && (
        <div className="h-0.5 bg-[var(--color-bg-muted)]">
          <div
            className="h-full bg-[var(--color-action)] transition-all duration-300"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {/* Before/After slider */}
      {expanded && canExpand && job.compressedUrl && job.compressedSize != null && (
        <div className="px-4 pb-4 pt-1 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
          <BeforeAfterSlider
            originalUrl={job.thumbnailUrl}
            originalSize={job.originalSize}
            compressedUrl={job.compressedUrl}
            compressedSize={job.compressedSize}
            ssimScore={job.ssimScore}
          />
        </div>
      )}
    </div>
  );
}
