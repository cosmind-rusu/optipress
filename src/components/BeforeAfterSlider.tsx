import { useRef, useState, useCallback, useEffect, type PointerEvent } from 'react';
import { formatBytes } from '../lib/formats';

interface BeforeAfterSliderProps {
  originalUrl: string;
  originalSize: number;
  compressedUrl: string;
  compressedSize: number;
}

export default function BeforeAfterSlider({
  originalUrl,
  originalSize,
  compressedUrl,
  compressedSize,
}: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(50);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Track container width for clipping
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const updatePosition = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(0, Math.min(100, pct)));
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    isDragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updatePosition(e.clientX);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging.current) return;
    updatePosition(e.clientX);
  };

  const onPointerUp = () => {
    isDragging.current = false;
  };

  const savings = originalSize > 0
    ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
    : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-lg overflow-hidden bg-white border border-[var(--color-border)] select-none"
      style={{
        aspectRatio: '16/9',
        cursor: 'ew-resize',
        boxShadow: 'var(--shadow-whisper)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Checker pattern for transparency */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(45deg, #f1f2f3 25%, transparent 25%), linear-gradient(-45deg, #f1f2f3 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f2f3 75%), linear-gradient(-45deg, transparent 75%, #f1f2f3 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        }}
      />

      {/* Compressed image (background) */}
      <img
        src={compressedUrl}
        alt="Compressed"
        className="absolute inset-0 w-full h-full object-contain"
        draggable={false}
      />

      {/* Original image (clipped to left) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${position}%` }}
      >
        <img
          src={originalUrl}
          alt="Original"
          className="absolute inset-0 h-full object-contain"
          style={{ width: containerWidth || '100%', maxWidth: 'none' }}
          draggable={false}
        />
      </div>

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
        style={{
          left: `${position}%`,
          boxShadow: '0 0 0 1px rgba(17, 24, 39, 0.2), 0 2px 8px rgba(17, 24, 39, 0.25)',
        }}
      >
        {/* Handle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white border border-[var(--color-border)] flex items-center justify-center gap-0.5 pointer-events-none"
          style={{ boxShadow: '0 4px 12px rgba(17, 24, 39, 0.15)' }}>
          <div className="w-0.5 h-3.5 rounded bg-[var(--color-text-muted)]" />
          <div className="w-0.5 h-3.5 rounded bg-[var(--color-text-muted)]" />
        </div>
      </div>

      {/* Left label */}
      <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-white/95 backdrop-blur-sm border border-[var(--color-border)] text-[11px] font-mono font-medium text-[var(--color-text-secondary)] pointer-events-none">
        Original · {formatBytes(originalSize)}
      </div>

      {/* Right label */}
      <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-[var(--color-bg-dark)] border border-[var(--color-bg-deep)] text-[11px] font-mono font-medium text-white pointer-events-none flex items-center gap-1.5">
        <span>Compressed · {formatBytes(compressedSize)}</span>
        {savings > 0 && (
          <span className="text-[var(--color-success)]" style={{ color: '#4ade80' }}>
            −{savings}%
          </span>
        )}
      </div>
    </div>
  );
}
