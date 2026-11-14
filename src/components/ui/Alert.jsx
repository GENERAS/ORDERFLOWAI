import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../utils/cn';

const variants = {
  error: {
    container: 'border-red-200 bg-red-50 text-red-800',
    icon: AlertCircle,
    iconClassName: 'text-red-500',
  },
  success: {
    container: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    icon: CheckCircle2,
    iconClassName: 'text-emerald-500',
  },
  warning: {
    container: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: AlertTriangle,
    iconClassName: 'text-amber-500',
  },
  info: {
    container: 'border-brand-200 bg-brand-50 text-brand-800',
    icon: Info,
    iconClassName: 'text-brand-500',
  },
};

export function Alert({ variant = 'info', title, className, children }) {
  const config = variants[variant] ?? variants.info;
  const Icon = config.icon;

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm',
        config.container,
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 h-4 w-4 shrink-0', config.iconClassName)}
        aria-hidden="true"
      />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5' : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}
