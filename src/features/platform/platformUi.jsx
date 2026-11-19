import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageLoader } from '../../components/ui/PageLoader';
import { formatLabel } from './platformFormatters';

export function PageIntro({ title, description, badge }) {
  return (
    <section className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
      </div>
      {badge ? <Badge variant="neutral">{badge}</Badge> : null}
    </section>
  );
}

const badgeVariants = {
  active: 'success',
  connected: 'success',
  ready: 'success',
  verified: 'success',
  completed: 'success',
  paid: 'success',
  open: 'success',
  configured: 'success',
  inactive: 'neutral',
  missing: 'neutral',
  refunded: 'neutral',
  not_connected: 'neutral',
  not_configured: 'neutral',
  draft: 'neutral',
  pending: 'warning',
  awaiting_confirmation: 'warning',
  awaiting_business_approval: 'warning',
  partially_paid: 'warning',
  partially_refunded: 'warning',
  expired: 'warning',
  revoked: 'warning',
  rate_limited: 'warning',
  coming_soon: 'warning',
  failed: 'danger',
  rejected: 'danger',
  cancelled: 'danger',
  error: 'danger',
};

export function StateBadge({ value }) {
  return <Badge variant={badgeVariants[value] ?? 'neutral'}>{formatLabel(value)}</Badge>;
}

export function ResourcePanel({
  state,
  icon: Icon,
  emptyTitle = 'Nothing to show',
  emptyDescription = 'No records are available for this view.',
  children,
}) {
  if (state.status === 'loading') return <PageLoader />;

  if (state.status === 'error') {
    return (
      <Alert variant="error" title="Data could not be loaded">
        {state.error}
      </Alert>
    );
  }

  if (!state.rows?.length) {
    return <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} />;
  }

  return children;
}

export function DataTable({ columns, rows, rowKey = (row) => row.id }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50/70">
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-3 align-top text-slate-600">
                  {column.render ? column.render(row) : row[column.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SectionCard({ title, description, action, children }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle as="h2">{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </CardHeader>
      <div className="px-5 pb-5 pt-4">{children}</div>
    </Card>
  );
}
