import { useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { SelectField } from '../../components/ui/SelectField';
import { formatDate, formatLabel } from './platformFormatters';
import {
  fetchPlatformAudit,
  fetchSuperAdminActions,
} from './platformService';
import {
  DataTable,
  PageIntro,
  ResourcePanel,
  SectionCard,
} from './platformUi';

const limitOptions = [
  { value: 25, label: 'Latest 25' },
  { value: 50, label: 'Latest 50' },
  { value: 100, label: 'Latest 100' },
  { value: 200, label: 'Latest 200' },
];

const columns = [
  {
    key: 'action',
    label: 'Action',
    render: (row) => (
      <span className="font-medium text-slate-900">{formatLabel(row.action)}</span>
    ),
  },
  {
    key: 'actor',
    label: 'Actor',
    render: (row) => (
      <span className="font-mono text-xs text-slate-500">
        {row.actor_user_id ? `${row.actor_user_id.slice(0, 8)}…` : 'System'}
      </span>
    ),
  },
  {
    key: 'permission',
    label: 'Permission',
    render: (row) => <span className="text-xs">{row.permission ?? '—'}</span>,
  },
  {
    key: 'entity',
    label: 'Entity',
    render: (row) => (
      <span className="text-xs">
        {row.entity_type
          ? `${formatLabel(row.entity_type)}${row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ''}`
          : '—'}
      </span>
    ),
  },
  {
    key: 'justification',
    label: 'Justification',
    render: (row) => (
      <span className="line-clamp-2 text-xs">{row.justification ?? '—'}</span>
    ),
  },
  {
    key: 'created',
    label: 'Recorded',
    render: (row) => <span className="text-xs">{formatDate(row.created_at)}</span>,
  },
];

const adminColumns = [
  {
    key: 'action',
    label: 'Action',
    render: (row) => (
      <span className="font-medium text-slate-900">{formatLabel(row.action)}</span>
    ),
  },
  {
    key: 'actor',
    label: 'Actor',
    render: (row) => (
      <span className="font-mono text-xs text-slate-500">
        {row.actor_user_id ? `${row.actor_user_id.slice(0, 8)}…` : 'System'}
      </span>
    ),
  },
  {
    key: 'target',
    label: 'Target',
    render: (row) => (
      <span className="font-mono text-xs text-slate-500">
        {row.target_user_id
          ? `user ${row.target_user_id.slice(0, 8)}`
          : row.target_business_id
            ? `business ${row.target_business_id.slice(0, 8)}`
            : '—'}
      </span>
    ),
  },
  {
    key: 'created',
    label: 'Recorded',
    render: (row) => <span className="text-xs">{formatDate(row.created_at)}</span>,
  },
];

export default function PlatformAuditPage() {
  const [limit, setLimit] = useState(50);
  const [audit, setAudit] = useState({ status: 'loading', rows: [], error: null });
  const [adminActions, setAdminActions] = useState({
    status: 'loading',
    rows: [],
    error: null,
  });

  useEffect(() => {
    let active = true;

    Promise.resolve()
      .then(() => {
        setAudit((previous) => ({ ...previous, status: 'loading', error: null }));
        setAdminActions((previous) => ({ ...previous, status: 'loading', error: null }));
        return Promise.allSettled([
          fetchPlatformAudit({ limit }),
          fetchSuperAdminActions({ limit }),
        ]);
      })
      .then(([platformActions, superAdminActions]) => {
        if (!active) return;

        setAudit({
          status: platformActions.status === 'fulfilled' ? 'ready' : 'error',
          rows: platformActions.status === 'fulfilled' ? platformActions.value : [],
          error:
            platformActions.status === 'rejected' ? platformActions.reason?.message : null,
        });
        setAdminActions({
          status: superAdminActions.status === 'fulfilled' ? 'ready' : 'error',
          rows: superAdminActions.status === 'fulfilled' ? superAdminActions.value : [],
          error:
            superAdminActions.status === 'rejected'
              ? superAdminActions.reason?.message
              : null,
        });
      });

    return () => {
      active = false;
    };
  }, [limit]);

  return (
    <div className="space-y-6">
      <PageIntro
        title="Support & audit"
        description="Immutable platform and super admin action logs. Records are read from database audit tables."
        badge="Audited"
      />

      <Alert variant="info" title="Metrics stay honest">
        This view lists recorded events only. Absence of rows means no actions were
        recorded, not that activity is healthy.
      </Alert>

      <SectionCard
        title="Platform actions"
        description="Support sessions, sensitive reads, permission changes and configuration updates."
        action={
          <SelectField
            className="w-36"
            aria-label="Audit log size"
            value={String(limit)}
            onChange={(event) => setLimit(Number(event.target.value))}
            options={limitOptions}
            placeholder="Limit"
          />
        }
      >
        <ResourcePanel
          state={audit}
          icon={ScrollText}
          emptyTitle="No platform actions recorded"
          emptyDescription="The audit log is empty for this platform."
        >
          <DataTable columns={columns} rows={audit.rows} />
        </ResourcePanel>
      </SectionCard>

      <SectionCard
        title="Super admin actions"
        description="Grant, revoke and super admin directory actions."
      >
        <ResourcePanel
          state={adminActions}
          icon={Search}
          emptyTitle="No super admin actions recorded"
          emptyDescription="No super admin actions have been logged."
        >
          <DataTable columns={adminColumns} rows={adminActions.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
