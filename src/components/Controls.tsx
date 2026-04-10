import type { CompressionSettings, OutputFormat, Effort } from '../types';

interface ControlsProps {
  settings: CompressionSettings;
  onChange: (settings: CompressionSettings) => void;
}

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: 'webp', label: 'WebP' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'original', label: 'Original' },
];

const EFFORTS: { value: Effort; label: string; hint: string }[] = [
  { value: 'fast', label: 'Fast', hint: 'Quick encode, larger output' },
  { value: 'balanced', label: 'Balanced', hint: 'Default' },
  { value: 'best', label: 'Best', hint: 'Slowest, smallest output' },
];

export default function Controls({ settings, onChange }: ControlsProps) {
  const set = <K extends keyof CompressionSettings>(key: K, value: CompressionSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div
      className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden"
      style={{ boxShadow: 'var(--shadow-whisper)' }}
    >
      {/* Row 1: Format · Quality · Max width */}
      <div className="divide-y divide-[var(--color-border)] sm:divide-y-0 sm:divide-x sm:flex sm:items-stretch">
        {/* Format */}
        <div className="flex-1 px-5 py-4">
          <div className="label-caps mb-2.5">Format</div>
          <div className="flex rounded-md border border-[var(--color-border)] p-0.5 bg-[var(--color-bg-subtle)]">
            {FORMATS.map(fmt => (
              <button
                key={fmt.value}
                onClick={() => set('outputFormat', fmt.value)}
                className={`
                  flex-1 px-2 py-1.5 text-[12px] font-semibold rounded transition-all duration-150
                  ${settings.outputFormat === fmt.value
                    ? 'bg-white text-[var(--color-text)] shadow-sm border border-[var(--color-border)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }
                `}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div className="flex-1 px-5 py-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="label-caps">Quality</div>
            <span className="text-[13px] font-mono font-medium tabular-nums text-[var(--color-action)]">
              {settings.quality}
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            step={1}
            value={settings.quality}
            onChange={e => set('quality', Number(e.target.value))}
            className="w-full"
            style={{
              background: `linear-gradient(to right, #1060ff 0%, #1060ff ${settings.quality}%, #e5e7eb ${settings.quality}%, #e5e7eb 100%)`,
            }}
          />
        </div>

        {/* Max width */}
        <div className="flex-1 px-5 py-4">
          <div className="label-caps mb-2.5">Max width</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={64}
              max={8192}
              step={1}
              placeholder="No resize"
              value={settings.maxWidth ?? ''}
              onChange={e => set('maxWidth', e.target.value ? Number(e.target.value) : null)}
              className="flex-1 w-full px-3 py-1.5 text-[13px] font-medium text-[var(--color-text)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action-ring)] placeholder:text-[var(--color-text-muted)] transition-all"
            />
            <span className="text-[12px] font-mono text-[var(--color-text-muted)]">px</span>
          </div>
        </div>
      </div>

      {/* Row 2: Effort */}
      <div className="flex items-center gap-4 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
        <div className="label-caps whitespace-nowrap">Encoder effort</div>
        <div className="flex rounded-md border border-[var(--color-border)] p-0.5 bg-white">
          {EFFORTS.map(eff => (
            <button
              key={eff.value}
              onClick={() => set('effort', eff.value)}
              title={eff.hint}
              className={`
                px-3 py-1 text-[12px] font-semibold rounded transition-all duration-150
                ${settings.effort === eff.value
                  ? 'bg-[var(--color-bg-dark)] text-white shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }
              `}
            >
              {eff.label}
            </button>
          ))}
        </div>
        <div className="hidden md:block text-[12px] text-[var(--color-text-muted)] ml-auto font-mono">
          mozjpeg · libwebp · oxipng
        </div>
      </div>
    </div>
  );
}
