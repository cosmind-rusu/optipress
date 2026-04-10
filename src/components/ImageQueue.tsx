import type { ImageJob } from '../types';
import ImageCard from './ImageCard';

interface ImageQueueProps {
  jobs: ImageJob[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onClear: () => void;
}

export default function ImageQueue({ jobs, onRemove, onRetry, onClear }: ImageQueueProps) {
  if (jobs.length === 0) return null;

  const doneCount = jobs.filter(j => j.status === 'done').length;
  const processingCount = jobs.filter(j => j.status === 'processing').length;
  const queuedCount = jobs.filter(j => j.status === 'queued').length;

  return (
    <section>
      {/* Queue header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-3">
          <h2 className="label-caps">
            {jobs.length} {jobs.length === 1 ? 'Image' : 'Images'}
          </h2>
          <div className="flex items-center gap-2 text-[12px]">
            {processingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[var(--color-action)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-action)] animate-pulse" />
                {processingCount} processing
              </span>
            )}
            {queuedCount > 0 && (
              <span className="text-[var(--color-text-muted)]">
                · {queuedCount} queued
              </span>
            )}
            {doneCount > 0 && processingCount === 0 && queuedCount === 0 && (
              <span className="inline-flex items-center gap-1.5 text-[var(--color-success)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                all done
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onClear}
          className="text-[12px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors px-2 py-1 rounded"
        >
          Clear all
        </button>
      </div>

      {/* Job list */}
      <div className="space-y-2">
        {jobs.map((job, i) => (
          <ImageCard
            key={job.id}
            job={job}
            onRemove={onRemove}
            onRetry={onRetry}
            index={i}
          />
        ))}
      </div>
    </section>
  );
}
