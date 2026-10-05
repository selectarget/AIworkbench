import React, { useEffect, useId, useRef } from 'react';
import { Icon } from '../icons/Icon';
import { focusablesIn, openDialogs } from '../../utils/dom';
import { SettingsModalLayout } from '../features/settings/SettingsModalLayout';

export interface ModalProps {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose(): void;
  wide?: boolean;
  className?: string;
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide,
  className
}: ModalProps): React.JSX.Element {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      closeRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // aria-modal="true" promises the rest of the page is inert, but Tab still walked out of the
  // dialog into the toolbar and both panels behind the backdrop.
  //
  // This listens on the document in the capture phase rather than on the dialog section, because
  // a section-scoped handler only runs while focus is ALREADY inside it.
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    openDialogs.push(root);
    const onKeyDown = (event: KeyboardEvent): void => {
      // Dialogs stack (a media preview opened from the library dialog), so only the innermost
      // one may claim Tab - otherwise an outer dialog would steal focus back from an inner one.
      if (event.key !== 'Tab' || openDialogs[openDialogs.length - 1] !== root) return;
      const focusable = focusablesIn(root);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = openDialogs.lastIndexOf(root);
      if (index !== -1) openDialogs.splice(index, 1);
    };
  }, []);

  const body =
    className === 'settings-modal' ? (
      <SettingsModalLayout>{children}</SettingsModalLayout>
    ) : (
      children
    );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className={`modal ${wide ? 'wide' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="关闭弹窗"
            title="关闭（Esc）"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal-body" ref={bodyRef}>
          {body}
        </div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}
