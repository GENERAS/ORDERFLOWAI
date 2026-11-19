import { useEffect, useState } from 'react';
import { PlugZap } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { formatDate } from './platformFormatters';
import { fetchPlatformIntegrations } from './platformService';
import {
  DataTable,
  PageIntro,
  ResourcePanel,
  SectionCard,
  StateBadge,
} from './platformUi';

const columns = [
  { key: 'name', label: 'Integration', render: (row) => row.name ?? row.code },
  {
    key: 'category',
    label: 'Category',
    render: (row) => <span className="text-xs">{row.category}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StateBadge value={row.status} />,
  },
  {
    key: 'detail',
    label: 'Detail',
    render: (row) => <span className="text-xs">{row.detail ?? '—'}</span>,
  },
  {
    key: 'activity',
    label: 'Last activity',
    render: (row) => <span className="text-xs">{formatDate(row.last_activity_at)}</span>,
  },
];

export default function PlatformIntegrationsPage() {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });

  useEffect(() => {
    let active = true;

    fetchPlatformIntegrations()
      .then((rows) => {
        if (active) setState({ status: 'ready', rows, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            rows: [],
            error: error.message ?? 'Unable to load integrations.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageIntro
        title="Integrations"
        description="Connection status derived from recorded platform data. No provider credentials or API keys are returned."
        badge="Read only"
      />

      <Alert variant="info" title="Status is evidence-based">
        A channel is reported as connected only when a business connection record exists
        in that state. Unused providers are shown as not configured.
      </Alert>

      <SectionCard title="Platform integrations" description="Current integration surface.">
        <ResourcePanel
          state={state}
          icon={PlugZap}
          emptyTitle="No integrations reported"
          emptyDescription="No integration records are available for this platform."
        >
          <DataTable columns={columns} rows={state.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
