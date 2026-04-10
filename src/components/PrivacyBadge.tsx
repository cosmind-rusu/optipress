import { useState, useRef, useEffect } from 'react';
import { Lock, X } from 'lucide-react';

export default function PrivacyBadge() {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expanded]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-md bg-[var(--color-success-subtle)] border border-[var(--color-success-border)] text-[var(--color-success)] hover:bg-[var(--color-success-subtle)] transition-colors"
      >
        <Lock size={12} strokeWidth={2.5} />
        <span className="text-[12px] font-semibold">100% local</span>
      </button>

      {expanded && (
        <div
          className="absolute right-0 top-10 z-50 w-80 p-5 rounded-lg bg-white border border-[var(--color-border)]"
          style={{ boxShadow: '0 10px 40px rgba(17, 24, 39, 0.12), 0 4px 12px rgba(17, 24, 39, 0.06)' }}
        >
          <button
            onClick={() => setExpanded(false)}
            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] transition-colors"
          >
            <X size={14} />
          </button>

          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-md bg-[var(--color-success-subtle)] flex items-center justify-center">
              <Lock size={13} className="text-[var(--color-success)]" strokeWidth={2.5} />
            </div>
            <span className="font-display font-semibold text-[14px] text-[var(--color-text)]">
              Your images never leave your device
            </span>
          </div>

          <p className="text-[13px] leading-[1.55] text-[var(--color-text-secondary)]">
            OptiPress runs entirely in your browser. Images are decoded, compressed, and re-encoded locally using the Canvas API inside a Web Worker.
          </p>

          <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
            <p className="text-[12px] font-mono text-[var(--color-text-muted)]">
              <span className="text-[var(--color-success)] font-semibold">✓</span> No server uploads
              <span className="mx-2">·</span>
              <span className="text-[var(--color-success)] font-semibold">✓</span> No tracking
              <span className="mx-2">·</span>
              <span className="text-[var(--color-success)] font-semibold">✓</span> No cookies
            </p>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
              Verify yourself: open DevTools → Network tab while processing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
