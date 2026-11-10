import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-6 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none select-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-200 animate-slide-in ${
            toast.type === 'error'
              ? 'bg-[#1F1215]/90 border-rose-500/30 text-rose-200'
              : toast.type === 'warning'
              ? 'bg-[#1F1912]/90 border-amber-500/30 text-amber-200'
              : toast.type === 'success'
              ? 'bg-[#121F18]/90 border-emerald-500/30 text-emerald-200'
              : 'bg-[#161822]/90 border-purple-500/30 text-purple-200'
          }`}
        >
          {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
          {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />}

          <div className="flex-1 pr-1">
            <h4 className="text-xs font-semibold text-white tracking-wide">{toast.title}</h4>
            {toast.message && <p className="text-[11px] text-gray-300 mt-0.5 leading-relaxed">{toast.message}</p>}
          </div>

          <button
            onClick={() => onDismiss(toast.id)}
            className="text-gray-400 hover:text-white transition-colors p-0.5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
