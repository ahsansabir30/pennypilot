import Modal from "./Modal";

export default function ConfirmDialog({ title, message, confirmLabel, confirmName, cancelName, busy, error, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; confirmName: string; cancelName: string;
  busy: boolean; error?: string; onConfirm: () => void; onCancel: () => void;
}) {
  return <Modal title={title} busy={busy} onClose={onCancel}>
    <p className="confirm-message">{message}</p>
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions">
      <button className="destructive-action confirm-action" type="button" aria-label={confirmName} disabled={busy}
        onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" aria-label={cancelName} data-modal-focus disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </Modal>;
}
