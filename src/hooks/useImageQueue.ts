import { useState, useCallback, useRef, useEffect } from 'react';
import type { ImageJob, CompressionSettings, WorkerResponse } from '../types';
import { detectFormat } from '../lib/formats';
import { WorkerPool, getDefaultPoolSize } from '../lib/workerPool';

function createJob(file: File): ImageJob {
  return {
    id: crypto.randomUUID(),
    file,
    originalSize: file.size,
    originalFormat: file.type || 'unknown',
    thumbnailUrl: URL.createObjectURL(file),
    status: 'queued',
    progress: 0,
    compressedBuffer: null,
    compressedSize: null,
    compressedFormat: null,
    compressedUrl: null,
    ssimScore: null,
    error: null,
    durationMs: null,
  };
}

export function useImageQueue(settings: CompressionSettings) {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const poolRef = useRef<WorkerPool | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Tracks job ids that still exist in state. Needed because WorkerPool can't
  // cancel a job mid-encode: if the user removes a job while its worker is
  // still running, the completion message arrives afterwards. Without this
  // guard the callback would create a Blob URL that nothing ever revokes.
  const liveJobsRef = useRef<Set<string>>(new Set());

  // Initialize pool once
  useEffect(() => {
    poolRef.current = new WorkerPool(getDefaultPoolSize());
    return () => {
      poolRef.current?.dispose();
      poolRef.current = null;
      liveJobsRef.current.clear();
      // Clean up all Blob URLs on unmount
      setJobs(prev => {
        for (const job of prev) {
          URL.revokeObjectURL(job.thumbnailUrl);
          if (job.compressedUrl) URL.revokeObjectURL(job.compressedUrl);
        }
        return [];
      });
    };
  }, []);

  const updateJob = useCallback((id: string, patch: Partial<ImageJob>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  }, []);

  const submitJob = useCallback(async (job: ImageJob) => {
    const pool = poolRef.current;
    if (!pool) return;

    updateJob(job.id, {
      status: 'processing',
      progress: 0,
      compressedBuffer: null,
      compressedSize: null,
      compressedFormat: null,
      compressedUrl: null,
      ssimScore: null,
      error: null,
      durationMs: null,
    });

    let buffer: ArrayBuffer;
    try {
      buffer = await job.file.arrayBuffer();
    } catch (err) {
      updateJob(job.id, {
        status: 'error',
        error: 'Failed to read file',
      });
      return;
    }

    // Detect format from magic bytes if MIME is missing or generic
    const detectedFormat = (!job.originalFormat || job.originalFormat === 'unknown' || job.originalFormat === 'application/octet-stream')
      ? detectFormat(buffer)
      : job.originalFormat;

    if (detectedFormat !== job.originalFormat) {
      updateJob(job.id, { originalFormat: detectedFormat });
    }

    pool.submit(
      {
        type: 'compress',
        jobId: job.id,
        buffer,
        originalFormat: detectedFormat,
        settings: settingsRef.current,
      },
      (response: WorkerResponse) => {
        // If the user removed the job while the worker was still encoding,
        // ignore every remaining message for this id. Don't create Blob URLs
        // that nothing owns.
        if (!liveJobsRef.current.has(job.id)) return;

        if (response.type === 'progress') {
          updateJob(job.id, { progress: response.progress ?? 0 });
          return;
        }

        if (response.type === 'done' && response.compressedBuffer) {
          const compressedUrl = URL.createObjectURL(
            new Blob([response.compressedBuffer], {
              type: response.compressedFormat ?? 'application/octet-stream',
            })
          );

          updateJob(job.id, {
            status: 'done',
            progress: 100,
            compressedBuffer: response.compressedBuffer,
            compressedSize: response.compressedSize ?? null,
            compressedFormat: response.compressedFormat ?? null,
            compressedUrl,
            ssimScore: response.ssimScore ?? null,
            durationMs: response.durationMs ?? null,
          });
          return;
        }

        if (response.type === 'error') {
          updateJob(job.id, {
            status: 'error',
            error: response.error ?? 'Unknown error',
          });
          // Clean up any existing Blob URL on error
          setJobs(prev => {
            const currentJob = prev.find(j => j.id === job.id);
            if (currentJob?.compressedUrl) {
              URL.revokeObjectURL(currentJob.compressedUrl);
              return prev.map(j => j.id === job.id ? { ...j, compressedUrl: null } : j);
            }
            return prev;
          });
        }
      }
    );
  }, [updateJob]);

  const addFiles = useCallback((files: File[]) => {
    const newJobs = files
      .filter(f => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif)$/i.test(f.name))
      .map(createJob);

    if (newJobs.length === 0) return;

    for (const job of newJobs) liveJobsRef.current.add(job.id);
    setJobs(prev => [...prev, ...newJobs]);

    // Dispatch all — the pool handles its own concurrency limits
    for (const job of newJobs) {
      submitJob(job);
    }
  }, [submitJob]);

  const removeJob = useCallback((id: string) => {
    liveJobsRef.current.delete(id);
    poolRef.current?.cancel(id);
    setJobs(prev => {
      const job = prev.find(j => j.id === id);
      if (job) {
        URL.revokeObjectURL(job.thumbnailUrl);
        if (job.compressedUrl) URL.revokeObjectURL(job.compressedUrl);
      }
      return prev.filter(j => j.id !== id);
    });
  }, []);

  const retryJob = useCallback((id: string) => {
    setJobs(prev => {
      const job = prev.find(j => j.id === id);
      if (!job) return prev;
      if (job.compressedUrl) URL.revokeObjectURL(job.compressedUrl);
      const reset = {
        ...job,
        status: 'queued' as const,
        progress: 0,
        compressedBuffer: null,
        compressedSize: null,
        compressedFormat: null,
        compressedUrl: null,
        ssimScore: null,
        error: null,
        durationMs: null,
      };
      liveJobsRef.current.add(id);
      // Submit the reset job asynchronously (state is stale in this closure)
      queueMicrotask(() => submitJob(reset));
      return prev.map(j => j.id === id ? reset : j);
    });
  }, [submitJob]);

  const clearAll = useCallback(() => {
    setJobs(prev => {
      for (const job of prev) {
        liveJobsRef.current.delete(job.id);
        URL.revokeObjectURL(job.thumbnailUrl);
        if (job.compressedUrl) URL.revokeObjectURL(job.compressedUrl);
        poolRef.current?.cancel(job.id);
      }
      return [];
    });
  }, []);

  return { jobs, addFiles, removeJob, retryJob, clearAll };
}
