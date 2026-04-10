import { useState } from 'react';
import type { CompressionSettings } from './types';
import { useImageQueue } from './hooks/useImageQueue';
import DropZone from './components/DropZone';
import Controls from './components/Controls';
import ImageQueue from './components/ImageQueue';
import StatsBar from './components/StatsBar';
import DownloadButton from './components/DownloadButton';
import PrivacyBadge from './components/PrivacyBadge';

const DEFAULT_SETTINGS: CompressionSettings = {
  outputFormat: 'webp',
  quality: 80,
  maxWidth: null,
  effort: 'balanced',
  webpLossless: false,
  stripMetadata: true,
};

export default function App() {
  const [settings, setSettings] = useState<CompressionSettings>(DEFAULT_SETTINGS);
  const { jobs, addFiles, removeJob, retryJob, clearAll } = useImageQueue(settings);

  const hasJobs = jobs.length > 0;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Top bar */}
      <header className="border-b border-[var(--color-border)] bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-[1080px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* Logo mark */}
            <img src="/optipress.svg" alt="OptiPress" width={28} height={28} className="w-7 h-7" />
            <span className="font-display font-bold text-[15px] tracking-tight">OptiPress</span>
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider rounded text-[var(--color-text-muted)] border border-[var(--color-border)]">
              v0.1
            </span>
          </div>

          <nav className="flex items-center gap-4">
            <a
              href="https://github.com/cosmind-rusu/optipress"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-action)] transition-colors"
            >
              GitHub
            </a>
            <PrivacyBadge />
          </nav>
        </div>
      </header>

      {/* Hero — only when empty */}
      {!hasJobs && (
        <section className="relative border-b border-[var(--color-border)] overflow-hidden bg-[var(--color-bg-subtle)]">
          {/* Subtle grid background */}
          <div
            className="absolute inset-0 opacity-[0.4] pointer-events-none"
            style={{
              backgroundImage: `linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)`,
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 40%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 40%, transparent 100%)',
            }}
          />

          <div className="relative max-w-[1080px] mx-auto px-6 pt-16 pb-10">
            <div className="max-w-2xl">
              <div className="label-caps mb-4">Privacy-first image optimizer</div>
              <h1 className="font-display font-bold text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-text)]">
                Compress images locally.
                <br />
                <span className="text-[var(--color-text-muted)]">Nothing leaves your device.</span>
              </h1>
              <p className="mt-5 text-[17px] leading-[1.6] text-[var(--color-text-secondary)] max-w-xl">
                Drop images and OptiPress re-encodes them in your browser using
                native WebAssembly codecs — mozjpeg, libwebp, libavif and oxipng. Zero
                uploads, zero tracking — verified in your Network tab.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--color-text-muted)]">
                <FeaturePill>Accepts JPEG · PNG · WebP · AVIF</FeaturePill>
                <FeaturePill>Outputs JPEG · PNG · WebP · AVIF</FeaturePill>
                <FeaturePill>Batch + ZIP download</FeaturePill>
                <FeaturePill>Web Worker powered</FeaturePill>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main content */}
      <main className="max-w-[1080px] mx-auto px-6 py-8 space-y-5">

        {/* Drop zone */}
        {hasJobs ? (
          <DropZone onFiles={addFiles} compact />
        ) : (
          <DropZone onFiles={addFiles} />
        )}

        {/* Controls — always visible once there are jobs */}
        {hasJobs && <Controls settings={settings} onChange={setSettings} />}

        {/* Image queue */}
        <ImageQueue
          jobs={jobs}
          onRemove={removeJob}
          onRetry={retryJob}
          onClear={clearAll}
        />
      </main>

      {/* Sticky footer bar with stats + download */}
      {hasJobs && (
        <div className="sticky bottom-0 z-30 border-t border-[var(--color-border)] bg-white/95 backdrop-blur-md">
          <div className="max-w-[1080px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <StatsBar jobs={jobs} />
            <DownloadButton jobs={jobs} />
          </div>
        </div>
      )}

      {/* Footer */}
      {!hasJobs && (
        <footer className="border-t border-[var(--color-border)] mt-10">
          <div className="max-w-[1080px] mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-[13px] text-[var(--color-text-muted)]">
            <div>
              OptiPress · 100% client-side compression
            </div>
            <div className="flex items-center gap-5">
              <span>No servers</span>
              <span>No tracking</span>
              <span>No accounts</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function FeaturePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-1 h-1 rounded-full bg-[var(--color-action)]" />
      {children}
    </span>
  );
}
