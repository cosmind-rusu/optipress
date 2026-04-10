import type { WorkerRequest, WorkerResponse } from '../types';

type JobHandler = (response: WorkerResponse) => void;

interface PendingJob {
  request: WorkerRequest;
  handler: JobHandler;
}

/**
 * Worker pool that fans out compression jobs across multiple WASM workers.
 *
 * Why a pool and not a single worker?
 *  - WASM codec decode + lanczos3 resize + mozjpeg encode can take hundreds of ms per image
 *  - Most users have 4–16 cores idle while compressing
 *  - Each worker owns its own codec instances (no cross-thread WASM sharing)
 *
 * Concurrency is capped to min(hardwareConcurrency, 4) by default so we don't
 * instantiate megabytes of WASM modules on a 16-core machine only to thrash
 * the disk cache for a single-image batch.
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private busy = new Set<Worker>();
  private activeJobs = new Map<string, { worker: Worker; handler: JobHandler }>();
  private queue: PendingJob[] = [];
  private disposed = false;

  constructor(private poolSize: number) {
    for (let i = 0; i < poolSize; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): Worker {
    const worker = new Worker(
      new URL('../workers/compress.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { type, jobId } = event.data;

      if (type === 'ready') return; // init handshake — no job to dispatch

      const active = this.activeJobs.get(jobId);
      if (!active) return;

      active.handler(event.data);

      // Terminal states release the worker back to the pool
      if (type === 'done' || type === 'error') {
        this.activeJobs.delete(jobId);
        this.busy.delete(worker);
        this.drainQueue();
      }
    };

    worker.onerror = (err) => {
      console.error('[WorkerPool] worker error:', err);
      // Reap and respawn to keep pool size stable
      this.respawn(worker);
    };

    this.workers.push(worker);
    return worker;
  }

  private respawn(dead: Worker) {
    dead.terminate();
    const idx = this.workers.indexOf(dead);
    if (idx >= 0) this.workers.splice(idx, 1);
    this.busy.delete(dead);

    // Fail any jobs bound to this worker
    for (const [jobId, active] of this.activeJobs) {
      if (active.worker === dead) {
        active.handler({
          type: 'error',
          jobId,
          error: 'Worker crashed — please retry',
        });
        this.activeJobs.delete(jobId);
      }
    }

    if (!this.disposed && this.workers.length < this.poolSize) {
      this.spawnWorker();
    }
  }

  private findIdleWorker(): Worker | undefined {
    return this.workers.find(w => !this.busy.has(w));
  }

  private drainQueue() {
    while (this.queue.length > 0) {
      const idle = this.findIdleWorker();
      if (!idle) return;

      const next = this.queue.shift()!;
      this.dispatch(idle, next);
    }
  }

  private dispatch(worker: Worker, job: PendingJob) {
    this.busy.add(worker);
    this.activeJobs.set(job.request.jobId, { worker, handler: job.handler });
    // Transfer the buffer to avoid copy — this is the expensive bit for large images
    worker.postMessage(job.request, [job.request.buffer]);
  }

  /**
   * Submit a compression job. Handler is invoked for each message
   * (progress updates + the final done/error response).
   */
  submit(request: WorkerRequest, handler: JobHandler) {
    if (this.disposed) {
      handler({ type: 'error', jobId: request.jobId, error: 'Pool disposed' });
      return;
    }

    const idle = this.findIdleWorker();
    if (idle) {
      this.dispatch(idle, { request, handler });
    } else {
      this.queue.push({ request, handler });
    }
  }

  /**
   * Remove a queued job (jobs already dispatched to a worker can't be cancelled
   * mid-encode without terminating the worker).
   */
  cancel(jobId: string): boolean {
    const idx = this.queue.findIndex(j => j.request.jobId === jobId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  dispose() {
    this.disposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.busy.clear();
    this.activeJobs.clear();
    this.queue = [];
  }

  get stats() {
    return {
      size: this.workers.length,
      busy: this.busy.size,
      idle: this.workers.length - this.busy.size,
      queued: this.queue.length,
      active: this.activeJobs.size,
    };
  }
}

/**
 * Choose a sensible pool size. Each worker instantiates several MB of WASM
 * modules on first use, so blindly spawning 16 workers is wasteful for small
 * batches. We cap at 4 which covers the common case (batch of 10–50 images)
 * while keeping memory bounded.
 */
export function getDefaultPoolSize(): number {
  const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  return Math.max(1, Math.min(4, hw));
}
