import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ title, onClose, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`modal-shell ${widths[size]}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-blue-900/40">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  extraField?: { label: string; value: string; onChange: (v: string) => void; placeholder?: string };
}

export function ConfirmDialog({
  title, message, confirmLabel = 'ยืนยัน', danger = false,
  onConfirm, onCancel, extraField,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel} size="sm">
      <p className="text-gray-300 text-sm mb-4">{message}</p>
      {extraField && (
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">{extraField.label}</label>
          <input
            className="w-full bg-navy-900 border border-blue-900/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            value={extraField.value}
            onChange={(e) => extraField.onChange(e.target.value)}
            placeholder={extraField.placeholder}
          />
        </div>
      )}
      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-blue-900/50 rounded-lg transition-colors">
          ยกเลิก
        </button>
        <button
          onClick={onConfirm}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-amber-500 hover:bg-amber-600 text-navy-900'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
