import V2Modal from './V2Modal.jsx';

/* ============================================
   V2 CONFIRM — styled confirmation dialog

   Replaces window.confirm() calls. Single
   primary action (often destructive), inert
   cancel link, consistent visual register.

   Props:
     • open
     • onClose
     • onConfirm   — handler for the primary action
     • eyebrow     — italic eyebrow ("careful")
     • title       — main question
     • description — supporting copy
     • confirmLabel — button text (default "Confirm")
     • confirmTone  — 'orange' (default) | 'danger' | 'teal'
     • loading      — disables the button while a write is in-flight
============================================ */

export default function V2Confirm({
    open,
    onClose,
    onConfirm,
    eyebrow = 'careful',
    title,
    description,
    confirmLabel = 'Confirm',
    confirmTone = 'orange',
    loading = false,
}) {
    return (
        <V2Modal
            open={open}
            onClose={onClose}
            eyebrow={eyebrow}
            title={title}
            size="sm"
            footer={
                <>
                    <button
                        type="button"
                        className="v2-btn-link"
                        onClick={onClose}
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={`v2-btn v2-btn--${confirmTone}`}
                        onClick={onConfirm}
                        disabled={loading}
                    >
                        {loading ? 'Working…' : confirmLabel}
                    </button>
                </>
            }
        >
            {description && <p className="v2-confirm__body">{description}</p>}
        </V2Modal>
    );
}
