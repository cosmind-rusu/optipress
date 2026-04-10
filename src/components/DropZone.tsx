import { useRef, useState, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { Upload, Plus } from 'lucide-react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  compact?: boolean;
}

export default function DropZone({ onFiles, compact = false }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).filter(f =>
      f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif)$/i.test(f.name)
    );
    if (arr.length > 0) onFiles(arr);
  }, [onFiles]);

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  if (compact) {
    return (
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          flex items-center justify-center gap-2.5 px-5 py-3 cursor-pointer rounded-lg border transition-all duration-150
          ${isDragOver
            ? 'border-[var(--color-action)] bg-[var(--color-action-subtle)]'
            : 'border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] hover:border-[var(--color-action)] hover:bg-[var(--color-action-subtle)]'
          }
        `}
      >
        <Plus size={15} className={isDragOver ? 'text-[var(--color-action)]' : 'text-[var(--color-text-muted)]'} strokeWidth={2.5} />
        <span className={`text-[13px] font-medium ${isDragOver ? 'text-[var(--color-action)]' : 'text-[var(--color-text-secondary)]'}`}>
          {isDragOver ? 'Drop to add images' : 'Add more images'}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.jpg,.jpeg,.png,.webp,.avif"
          onChange={onChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        relative flex flex-col items-center justify-center min-h-[260px] cursor-pointer rounded-xl border-2 border-dashed
        transition-all duration-200 select-none overflow-hidden group
        ${isDragOver
          ? 'border-[var(--color-action)] bg-[var(--color-action-subtle)]'
          : 'border-[var(--color-border-strong)] bg-white hover:border-[var(--color-action)] hover:bg-[var(--color-action-subtle)]'
        }
      `}
      style={{ boxShadow: 'var(--shadow-whisper)' }}
    >
      <div className={`relative z-10 flex flex-col items-center gap-4 transition-transform duration-200 ${isDragOver ? 'scale-[1.02]' : ''}`}>
        {/* Icon */}
        <div className={`
          w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-200
          ${isDragOver
            ? 'bg-[var(--color-action)] text-white shadow-md'
            : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border)] group-hover:bg-white group-hover:border-[var(--color-action)] group-hover:text-[var(--color-action)]'
          }
        `}>
          <Upload size={22} strokeWidth={2} />
        </div>

        {/* Text */}
        <div className="text-center">
          <p className="font-display text-[18px] font-semibold text-[var(--color-text)] leading-tight">
            {isDragOver ? 'Drop to compress' : 'Drop images here'}
          </p>
          <p className="text-[14px] text-[var(--color-text-muted)] mt-1">
            or <span className="text-[var(--color-action)] underline underline-offset-2 font-medium">browse files</span>
          </p>
        </div>

        {/* Formats */}
        <div className="flex items-center gap-2 mt-1">
          {['JPEG', 'PNG', 'WebP', 'AVIF'].map(fmt => (
            <span
              key={fmt}
              className="text-[11px] font-mono font-medium text-[var(--color-text-muted)] px-2 py-0.5 rounded bg-[var(--color-bg-muted)] border border-[var(--color-border)]"
            >
              {fmt}
            </span>
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.jpg,.jpeg,.png,.webp,.avif"
        onChange={onChange}
        className="hidden"
      />
    </div>
  );
}
