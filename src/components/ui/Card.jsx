import { cn } from '../../utils/cn';

export function Card({ className, ...props }) {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, as: Heading = 'h3', ...props }) {
  return (
    <Heading
      className={cn('text-sm font-semibold tracking-tight text-slate-900', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('mt-1 text-sm text-slate-500', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-5 pb-5 pt-3', className)} {...props} />;
}
