export type OutputFormat = 'webp' | 'jpeg' | 'png' | 'avif' | 'original';

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export type Effort = 'fast' | 'balanced' | 'best';

export interface CompressionSettings {
  outputFormat: OutputFormat;
  quality: number;          // 1-100, default 80
  maxWidth: number | null;  // null = no resize
  effort: Effort;           // encoder effort tier — speed vs compression
  webpLossless: boolean;
  stripMetadata: boolean;
}

export interface ImageJob {
  id: string;
  file: File;
  originalSize: number;
  originalFormat: string;
  thumbnailUrl: string;
  status: JobStatus;
  progress: number;         // 0-100
  compressedBuffer: ArrayBuffer | null;
  compressedSize: number | null;
  compressedFormat: string | null;
  compressedUrl: string | null;
  ssimScore: number | null;
  error: string | null;
  durationMs: number | null; // encode time for stats/telemetry
}

export interface WorkerRequest {
  type: 'compress';
  jobId: string;
  buffer: ArrayBuffer;
  originalFormat: string;
  settings: CompressionSettings;
}

export interface WorkerResponse {
  type: 'progress' | 'done' | 'error' | 'ready';
  jobId: string;
  progress?: number;
  compressedBuffer?: ArrayBuffer;
  compressedSize?: number;
  compressedFormat?: string;
  ssimScore?: number;
  durationMs?: number;
  error?: string;
}
