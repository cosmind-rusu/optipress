import type { ImageJob } from '../types';
import { formatBytes } from '../lib/formats';

interface StatsBarProps {
  jobs: ImageJob[];
}

export default function StatsBar({ jobs }: StatsBarProps) {
  const done = jobs.filter(j => j.status === 'done');

  if (done.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-action)] animate-pulse" />
        <span>Waiting for first image…</span>
      </div>
    );
  }

  const totalOriginal = done.reduce((s, j) => s + j.originalSize, 0);
  const totalCompressed = done.reduce((s, j) => s + (j.compressedSize ?? j.originalSize), 0);
  const totalSavings = totalOriginal > 0
    ? Math.round(((totalOriginal - totalCompressed) / totalOriginal) * 100)
    : 0;
  const saved = totalOriginal - totalCompressed;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {/* Done count */}
      <div className="flex items-center gap-2">
        <span className="label-caps text-[11px]">Optimized</span>
        <span className="font-display font-bold text-[15px] text-[var(--color-text)] tabular-nums">
          {done.length}
        </span>
      </div>

      <Divider />

      {/* Size delta */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-mono text-[var(--color-text-muted)] tabular-nums">
          {formatBytes(totalOriginal)}
        </span>
        <span className="text-[var(--color-text-muted)]">→</span>
        <span className="text-[13px] font-mono font-semibold text-[var(--color-text)] tabular-nums">
          {formatBytes(totalCompressed)}
        </span>
      </div>

      <Divider />

      {/* Savings badge */}
      {totalSavings > 0 ? (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--color-success-subtle)] border border-[var(--color-success-border)]">
          <span className="font-display font-bold text-[13px] text-[var(--color-success)] tabular-nums">
            −{totalSavings}%
          </span>
          <span className="text-[12px] text-[var(--color-success)] opacity-80">
            {formatBytes(saved)} saved
          </span>
        </div>
      ) : (
        <span className="text-[13px] text-[var(--color-text-muted)]">no reduction</span>
      )}
    </div>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-[var(--color-border)] hidden md:block" />;
}
