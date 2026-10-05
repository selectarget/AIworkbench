import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className = ''
}: SwitchProps): React.JSX.Element {
  const handleClick = (): void => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <div className={`flex items-center justify-between gap-4 py-2 ${className}`.trim()}>
      <div className="flex flex-col select-none text-left">
        <span className="text-sm font-medium text-slate-800">{label}</span>
        {description ? <span className="text-xs text-slate-500">{description}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          checked ? 'bg-blue-600' : 'bg-slate-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
