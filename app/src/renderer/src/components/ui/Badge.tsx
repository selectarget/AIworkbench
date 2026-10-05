import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({
  children,
  variant = 'neutral',
  size = 'sm',
  className = ''
}: BadgeProps): React.JSX.Element {
  const variantStyles = {
    primary: 'bg-blue-50 text-blue-700 border-blue-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200'
  }[variant];

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5 rounded-full',
    md: 'text-sm px-2.5 py-1 rounded-full'
  }[size];

  return (
    <span
      className={`inline-flex items-center font-medium border ${variantStyles} ${sizeStyles} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
