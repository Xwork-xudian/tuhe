import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

export function ConfirmDialog({
  open, onClose, onConfirm, title, description, confirmText = '确认', danger = false, busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{busy ? '处理中…' : confirmText}</button>
        </>
      }
    >
      <div className="confirm-content">
        <span className={danger ? 'confirm-icon danger' : 'confirm-icon'}><AlertTriangle size={20} /></span>
        <p>{description}</p>
      </div>
    </Modal>
  );
}
