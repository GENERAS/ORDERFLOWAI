import { useEffect, useState } from 'react';
import { ReceiptText, Search } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { formatDate, formatMoney } from './platformFormatters';
import { fetchPlatformOrdersPayments } from './platformService';
import {
  DataTable,
  PageIntro,
  ResourcePanel,
  SectionCard,
  StateBadge,
} from './platformUi';

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'awaiting_confirmation', label: 'Awaiting confirmation' },
  { value: 'awaiting_business_approval', label: 'Awaiting business approval' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const columns = [
  {
    key: 'order',
    label: 'Order',
    render: (row) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{row.order_number}</p>
        <p className="text-xs text-slate-400">{formatDate(row.created_at)}</p>
      </div>
    ),
  },
  {
    key: 'business',
    label: 'Business',
    render: (row) => (
      <div className="min-w-0">
        <p className="text-sm text-slate-800">{row.business_name}</p>
        <p className="font-mono text-xs text-slate-400">{row.business_id.slice(0, 8)}</p>
      </div>
    ),
  },
  {
    key: 'customer',
    label: 'Customer',
    render: (row) => <span className="text-xs">{row.customer_name_masked ?? '—'}</span>,
  },
  {
    key: 'status',
    label: 'Order status',
    render: (row) => <StateBadge value={row.status} />,
  },
  {
    key: 'total',
    label: 'Order total',
    render: (row) => formatMoney(row.total, row.currency),
  },
  {
    key: 'payment',
    label: 'Payment',
    render: (row) => <StateBadge value={row.payment_status} />,
  },
  {
    key: 'verified',
    label: 'Verified amount',
    render: (row) => formatMoney(row.verified_amount, row.currency),
  },
];

export default function PlatformOrdersPaymentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState({ search: '', status: '' });
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });

  useEffect(() => {
    let active = true;

    Promise.resolve()
      .then(() => {
        setState((previous) => ({ ...previous, status: 'loading', error: null }));
        return fetchPlatformOrdersPayments(query);
      })
      .then((rows) => {
        if (active) setState({ status: 'ready', rows, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            rows: [],
            error: error.message ?? 'Unable to load orders and payments.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [query]);

  return (
    <div className="space-y-6">
      <PageIntro
        title="Orders & payments"
        description="Cross-business order and payment investigation view. Customer contact details are masked."
        badge="Sensitive read"
      />

      <Alert variant="info" title="Payment amounts are merchant sales">
        Verified amounts are not platform revenue. Platform billing is not configured.
      </Alert>

      <SectionCard
        title="Order records"
        description="Search by order number or ID, then narrow by order status."
      >
        <form
          className="mb-5 grid gap-2 sm:grid-cols-[1fr_220px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery({ search: search.trim(), status });
          }}
        >
          <FormField
            label="Search orders"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Order number or ID"
          />
          <SelectField
            label="Order status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={statusOptions}
            placeholder="All statuses"
          />
          <button
            type="submit"
            className="h-10 self-end rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Apply
          </button>
        </form>

        <ResourcePanel
          state={state}
          icon={ReceiptText}
          emptyTitle="No orders found"
          emptyDescription="No orders match the selected filters."
        >
          <DataTable columns={columns} rows={state.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
