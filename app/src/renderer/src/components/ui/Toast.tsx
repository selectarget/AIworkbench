import React from 'react';
import { Icon } from '../icons/Icon';

export interface ToastMessage {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info';
}

export interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastProps): React.JSX.Element | null {
  if (!toasts.length) return null;

  return (
    <div className="fixed top-4 right-6 z-[10000] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        const isError =
          toast.type === 'error' ||
          toast.message.includes('失败') ||
          toast.message.includes('错误');
        const isSuccess =
          toast.type === 'success' ||
          toast.message.includes('完成') ||
          toast.message.includes('成功') ||
          toast.message.includes('已');

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl shadow-lg border backdrop-blur-md transition-all duration-300 ${
              isError
                ? 'bg-rose-950/90 text-rose-100 border-rose-800/40 shadow-rose-950/20'
                : isSuccess
                  ? 'bg-slate-900/90 text-slate-100 border-slate-700/50 shadow-slate-950/30'
                  : 'bg-slate-900/90 text-slate-100 border-slate-700/50 shadow-slate-950/30'
            }`}
            role="status"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`flex-shrink-0 w-2 h-2 rounded-full ${
                  isError ? 'bg-rose-500' : isSuccess ? 'bg-emerald-400' : 'bg-indigo-400'
                }`}
              />
              <span className="text-xs font-medium truncate">{toast.message}</span>
            </div>
            <button
              type="button"
              className="flex-shrink-0 text-slate-400 hover:text-slate-200 transition-colors p-0.5 rounded cursor-pointer"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭提示"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
