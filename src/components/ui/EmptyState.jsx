import { cn } from '../../utils/cn';

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon aria-hidden="true" className="h-6 w-6" />
        </span>
      ) : null}
      <h3 className="mt-4 text-sm font-semibold text-slate-900">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
