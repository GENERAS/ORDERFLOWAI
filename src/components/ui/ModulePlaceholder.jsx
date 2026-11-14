import { Badge } from './Badge';
import { EmptyState } from './EmptyState';

/**
 * Honest scaffold for MVP modules that are intentionally not implemented on Day 1.
 * It shows the module purpose and the planned capabilities from the blueprint.
 */
export function ModulePlaceholder({
  icon,
  title,
  description,
  emptyTitle,
  emptyDescription,
  upcoming = [],
}) {
  return (
    <section aria-labelledby="module-title" className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2
            id="module-title"
            className="text-lg font-semibold tracking-tight text-slate-900"
          >
            {title}
          </h2>
          <Badge variant="brand">Foundation</Badge>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>
      </div>

      <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />

      {upcoming.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Planned capabilities</h3>
          <ul className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            {upcoming.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
