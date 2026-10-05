import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'default' | 'soft' | 'flat';
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { children, variant = 'default', interactive = false, className = '', ...props },
  ref
) {
  const variantStyles = {
    default: 'bg-white border border-slate-200/80 shadow-xs',
    soft: 'bg-slate-50 border border-slate-200/60',
    flat: 'bg-transparent border border-slate-200'
  }[variant];

  const interactiveStyles = interactive
    ? 'cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all'
    : '';

  return (
    <div
      ref={ref}
      className={`rounded-xl p-4 text-slate-800 ${variantStyles} ${interactiveStyles} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
});
