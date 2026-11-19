import { useEffect, useState } from 'react';
import { MessageCircleMore } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { formatCount, formatDate } from './platformFormatters';
import { fetchPlatformCommunications } from './platformService';
import {
  DataTable,
  PageIntro,
  ResourcePanel,
  SectionCard,
  StateBadge,
} from './platformUi';

const columns = [
  {
    key: 'business',
    label: 'Business',
    render: (row) => (
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{row.business_name}</p>
        <p className="font-mono text-xs text-slate-400">{row.business_id.slice(0, 8)}</p>
      </div>
    ),
  },
  {
    key: 'channel',
    label: 'Channel',
    render: (row) => <span className="text-sm">{row.channel_name ?? row.channel}</span>,
  },
  {
    key: 'status',
    label: 'Connection',
    render: (row) => <StateBadge value={row.connection_status} />,
  },
  {
    key: 'phone',
    label: 'Number',
    render: (row) => <span className="text-xs">{row.phone_masked ?? '—'}</span>,
  },
  {
    key: 'conversations',
    label: 'Conversations (24h)',
    render: (row) => formatCount(row.conversations_24h),
  },
  {
    key: 'messages',
    label: 'Messages (24h)',
    render: (row) => formatCount(row.messages_24h),
  },
  {
    key: 'webhooks',
    label: 'Failed webhooks (24h)',
    render: (row) => formatCount(row.failed_webhooks_24h),
  },
  {
    key: 'health',
    label: 'Last health check',
    render: (row) => <span className="text-xs">{formatDate(row.last_health_check_at)}</span>,
  },
];

export default function PlatformCommunicationsPage() {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });

  useEffect(() => {
    let active = true;

    fetchPlatformCommunications({ limit: 100 })
      .then((rows) => {
        if (active) setState({ status: 'ready', rows, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            rows: [],
            error: error.message ?? 'Unable to load communication health.',
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
        title="Communications"
        description="Channel connection health and message volumes recorded by the platform."
        badge="Sensitive read"
      />

      <Alert variant="info" title="Credentials stay private">
        Access tokens and provider credentials are stored outside this console and are
        never displayed. Phone numbers are masked.
      </Alert>

      <SectionCard
        title="Channel connections"
        description="One row per business connection record, with rolling 24-hour activity counts."
      >
        <ResourcePanel
          state={state}
          icon={MessageCircleMore}
          emptyTitle="No channel connections"
          emptyDescription="No business has connected a communication channel yet."
        >
          <DataTable columns={columns} rows={state.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
