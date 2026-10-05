import React from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: ReadonlyArray<SelectOption>;
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, className = '', id, children, ...props },
  ref
) {
  const generatedId = React.useId();
  const selectId = id || (label ? generatedId : undefined);

  return (
    <div className="flex flex-col gap-1 w-full text-left">
      {label ? (
        <label htmlFor={selectId} className="text-xs font-medium text-slate-700 select-none">
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={selectId}
        className={`w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all disabled:bg-slate-50 disabled:text-slate-400 ${
          error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : ''
        } ${className}`.trim()}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        {children}
      </select>
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
});
