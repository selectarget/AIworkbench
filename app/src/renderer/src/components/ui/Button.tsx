import React from 'react';
import { Icon, type IconName } from '../icons/Icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconPosition = 'left',
    loading = false,
    className = '',
    children,
    disabled,
    ...props
  },
  ref
) {
  // Preserve semantic classes for backwards compatibility and test assertions
  const variantClass = variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger' : '';

  const sizeClasses = {
    sm: 'text-xs px-2.5 py-1 min-h-[26px]',
    md: 'text-sm px-3.5 py-1.5 min-h-[32px]',
    lg: 'text-base px-4 py-2 min-h-[40px]'
  }[size];

  const baseStyle =
    'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <button
      ref={ref}
      className={`${baseStyle} ${sizeClasses} ${variantClass} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="refresh" size={size === 'sm' ? 14 : 16} className="animate-spin" />
      ) : icon && iconPosition === 'left' ? (
        <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      ) : null}
      {children}
      {!loading && icon && iconPosition === 'right' ? (
        <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      ) : null}
    </button>
  );
});
