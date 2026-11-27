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
      {toasts.map((toast) => {
        const tone =
          toast.type === 'error'
            ? 'border-[#FB7185]/30 bg-[#1A1014]/95 text-[#FDA4AF]'
            : toast.type === 'warning'
            ? 'border-[#FBBF24]/30 bg-[#17140D]/95 text-[#FCD34D]'
            : toast.type === 'success'
            ? 'border-[#34D399]/30 bg-[#0E1A16]/95 text-[#6EE7B7]'
            : 'border-[#818CF8]/30 bg-studio-panel/95 text-[#C7D2FE]';
        const Icon =
          toast.type === 'error'
            ? XCircle
            : toast.type === 'warning'
            ? AlertTriangle
            : toast.type === 'success'
            ? CheckCircle2
            : Info;

        return (
          <div
            key={toast.id}
            role="status"
            className={`animate-slide-in pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-ss-panel backdrop-blur-xl ${tone}`}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.75} />
            <div className="flex-1 pr-1">
              <h4 className="ss-title-tight text-xs font-semibold text-studio-text">{toast.title}</h4>
              {toast.message && (
                <p className="text-[11px] text-studio-muted mt-0.5 leading-relaxed">{toast.message}</p>
              )}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="ss-btn p-1 text-studio-muted hover:text-studio-text"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
