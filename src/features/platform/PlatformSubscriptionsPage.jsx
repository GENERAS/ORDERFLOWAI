import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { formatDate, formatMoney } from './platformFormatters';
import { fetchPlatformSettings, fetchPlatformSubscriptions } from './platformService';
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
    render: (row) => row.business_name ?? '—',
  },
  { key: 'plan', label: 'Plan', render: (row) => row.plan ?? '—' },
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StateBadge value={row.status} />,
  },
  {
    key: 'amount',
    label: 'Amount',
    render: (row) => formatMoney(row.amount, row.currency),
  },
  {
    key: 'renewal',
    label: 'Current period end',
    render: (row) => formatDate(row.current_period_end),
  },
];

export default function PlatformSubscriptionsPage() {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });
  const [configured, setConfigured] = useState(null);

  useEffect(() => {
    let active = true;

    Promise.allSettled([fetchPlatformSubscriptions(), fetchPlatformSettings()]).then(
      ([subscriptions, settings]) => {
        if (!active) return;

        if (subscriptions.status === 'fulfilled') {
          setState({ status: 'ready', rows: subscriptions.value, error: null });
        } else {
          setState({
            status: 'error',
            rows: [],
            error: subscriptions.reason?.message ?? 'Unable to load subscriptions.',
          });
        }

        if (settings.status === 'fulfilled') {
          setConfigured(Boolean(settings.value?.subscriptions_configured));
        } else {
          setConfigured(null);
        }
      },
    );

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageIntro
        title="Subscriptions"
        description="Platform billing records only. Merchant order volume is never treated as subscription revenue."
        badge="Billing"
      />

      <Alert
        variant={configured ? 'info' : 'warning'}
        title={configured ? 'Local subscription records' : 'Platform billing is not configured'}
      >
        {configured
          ? 'These are local plan assignments only. No live payment gateway or platform billing provider is connected.'
          : 'No billing integration is connected, so no subscription or platform revenue figures are reported.'}
      </Alert>

      <SectionCard
        title="Subscription records"
        description="Local plan assignments recorded for each business workspace."
      >
        <ResourcePanel
          state={state}
          icon={CreditCard}
          emptyTitle="No subscription records"
          emptyDescription={
            configured
              ? 'No subscriptions have been recorded for any business.'
              : 'Billing is not configured for this deployment. No figures are invented.'
          }
        >
          <DataTable columns={columns} rows={state.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
