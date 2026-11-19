import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { formatCount, formatDate } from './platformFormatters';
import { fetchPlatformAiActivity } from './platformService';
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
    key: 'provider',
    label: 'Provider / model',
    render: (row) => (
      <div className="min-w-0">
        <p className="text-sm text-slate-800">{row.provider ?? 'Not recorded'}</p>
        <p className="text-xs text-slate-400">{row.model ?? '—'}</p>
      </div>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StateBadge value={row.status} />,
  },
  {
    key: 'tokens',
    label: 'Tokens',
    render: (row) => (
      <span className="text-xs">
        {formatCount(row.input_tokens)} in / {formatCount(row.output_tokens)} out
      </span>
    ),
  },
  {
    key: 'cost',
    label: 'Estimated cost',
    render: (row) =>
      row.estimated_cost_usd == null ? '—' : `$${Number(row.estimated_cost_usd).toFixed(6)}`,
  },
  {
    key: 'latency',
    label: 'Latency',
    render: (row) => (row.latency_ms == null ? '—' : `${formatCount(row.latency_ms)} ms`),
  },
  {
    key: 'created',
    label: 'Requested',
    render: (row) => <span className="text-xs">{formatDate(row.created_at)}</span>,
  },
];

export default function PlatformAiPage() {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });

  useEffect(() => {
    let active = true;

    fetchPlatformAiActivity({ limit: 100 })
      .then((rows) => {
        if (active) setState({ status: 'ready', rows, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            rows: [],
            error: error.message ?? 'Unable to load AI activity.',
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
        title="AI management"
        description="Recorded assistant usage across businesses. Provider keys, prompts and response bodies are never returned."
        badge="Sensitive read"
      />

      <Alert variant="info" title="Cost figures are estimates">
        Estimated cost is recorded by each assistant request; provider billing is not
        reconciled here.
      </Alert>

      <SectionCard
        title="Assistant activity"
        description="Most recent 100 requests. Error codes are shown without message bodies."
      >
        <ResourcePanel
          state={state}
          icon={Sparkles}
          emptyTitle="No AI requests recorded"
          emptyDescription="Assistant requests will appear here after a business uses the assistant."
        >
          <DataTable columns={columns} rows={state.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
