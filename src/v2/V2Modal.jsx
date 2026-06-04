import { useEffect, useRef } from 'react';

/* ============================================
   V2 MODAL — overlay with editorial header

   Replaces the legacy app's reliance on inline
   conditional renders + window.alert/confirm.

   Props:
     • open       — boolean toggle
     • onClose    — handler for backdrop click, Esc, X button
     • eyebrow    — short italic eyebrow above the title
     • title      — modal title (Grift)
     • children   — body content (form, copy, etc.)
     • footer     — footer slot (action buttons)
     • size       — 'sm' | 'md' (default) | 'lg'
============================================ */

export default function V2Modal({
    open,
    onClose,
    eyebrow,
    title,
    children,
    footer,
    size = 'md',
}) {
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="v2-modal-backdrop" onClick={onClose}>
            <div
                ref={ref}
                className={`v2-modal v2-modal--${size}`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="v2-modal__header">
                    <div className="v2-modal__title-block">
                        {eyebrow && <div className="v2-modal__eyebrow">{eyebrow}</div>}
                        {title && <h2 className="v2-modal__title">{title}</h2>}
                    </div>
                    <button
                        type="button"
                        className="v2-modal__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div className="v2-modal__body">{children}</div>
                {footer && <div className="v2-modal__footer">{footer}</div>}
            </div>
        </div>
    );
}
