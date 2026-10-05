import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, className = '', id, ...props },
  ref
) {
  const generatedId = React.useId();
  const inputId = id || (label ? generatedId : undefined);

  return (
    <div className="flex flex-col gap-1 w-full text-left">
      {label ? (
        <label htmlFor={inputId} className="text-xs font-medium text-slate-700 select-none">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={`w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all disabled:bg-slate-50 disabled:text-slate-400 ${
          error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : ''
        } ${className}`.trim()}
        {...props}
      />
      {error ? (
        <span className="text-xs text-red-500">{error}</span>
      ) : helperText ? (
        <span className="text-xs text-slate-500">{helperText}</span>
      ) : null}
    </div>
  );
});
