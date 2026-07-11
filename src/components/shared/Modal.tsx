/** Generic modal wrapper with overlay, animation, and theme-aware styling.
 *  Provides Escape-to-close, focus trap, and body scroll lock for parity with the
 *  mobile sidebar. */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape to close + body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  // Focus trap: focus the container on open, keep Tab inside the modal
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const container = containerRef.current;
    const focusable = container.querySelectorAll<HTMLElement>(
      'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    focusable[0]?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 animate-fade-in"
        style={{ backgroundColor: 'var(--color-surface-overlay)' }}
        onClick={onClose}
      />
      {/* Modal content */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`relative w-full ${maxWidth} rounded-xl border shadow-2xl animate-scale-in outline-none`}
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          borderColor: 'var(--color-border-default)',
        }}
      >
        {title && (
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderBottom: '1px solid var(--color-border-default)' }}
          >
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-color)' }}>
              {title}
            </h3>
            <button
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--text-color)] text-xl cursor-pointer transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[color-mix(in_srgb,var(--text-color)_5%,transparent)]"
            >
              &times;
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
