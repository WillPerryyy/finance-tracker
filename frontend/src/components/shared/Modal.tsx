import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  /** Pinned below the scrolling body so action buttons stay visible on long forms. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const WIDTHS = { sm: 440, md: 600, lg: 720 };

export default function Modal({ isOpen, onClose, title, subtitle, footer, size = 'md', children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    const first = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')
      ?? dialogRef.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')
      ?? dialogRef.current?.querySelector<HTMLElement>('button:not([aria-label="Close"])');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Portalled to <body> so no ancestor stacking context can trap it under the nav bar.
  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: 'rgba(20, 27, 36, 0.45)' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="flex min-h-full items-center justify-center p-4"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative w-full dialog-in flex flex-col"
          style={{
            maxWidth: WIDTHS[size],
            background: 'var(--color-surface)',
            borderRadius: 10,
            boxShadow: '0 18px 48px rgba(20, 27, 36, 0.22)',
            maxHeight: 'calc(100dvh - 3rem)',
          }}
        >
          <div className="shrink-0 flex items-start justify-between gap-4 px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div>
              <h2 id={titleId} className="text-[18px] font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
              {subtitle && <p className="text-[13px] mt-0.5 muted">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="icon-btn -mr-2 -mt-1" aria-label="Close">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5 overflow-y-auto flex-1 min-h-0">{children}</div>

          {footer && (
            <div className="shrink-0 px-6 py-4" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)', borderRadius: '0 0 10px 10px' }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
