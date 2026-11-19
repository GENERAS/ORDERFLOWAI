import { useEffect, useState } from 'react';
import { Search, Store } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { FormField } from '../../components/ui/FormField';
import { formatCount, formatDate } from './platformFormatters';
import { fetchPlatformStorefronts } from './platformService';
import {
  DataTable,
  PageIntro,
  ResourcePanel,
  SectionCard,
  StateBadge,
} from './platformUi';

const columns = [
  {
    key: 'store',
    label: 'Storefront',
    render: (row) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{row.store_name}</p>
        <p className="text-xs text-slate-400">/{row.slug}</p>
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
    key: 'status',
    label: 'Status',
    render: (row) => <StateBadge value={row.status} />,
  },
  {
    key: 'products',
    label: 'Published products',
    render: (row) => formatCount(row.visible_product_count),
  },
  {
    key: 'contact',
    label: 'Contact email',
    render: (row) => <span className="text-xs">{row.contact_email_masked ?? '—'}</span>,
  },
  {
    key: 'updated',
    label: 'Updated',
    render: (row) => <span className="text-xs">{formatDate(row.updated_at)}</span>,
  },
];

export default function PlatformStorefrontsPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });

  useEffect(() => {
    let active = true;

    Promise.resolve()
      .then(() => {
        setState((previous) => ({ ...previous, status: 'loading', error: null }));
        return fetchPlatformStorefronts({ search: query });
      })
      .then((rows) => {
        if (active) setState({ status: 'ready', rows, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            rows: [],
            error: error.message ?? 'Unable to load storefronts.',
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
        title="Storefronts"
        description="Live storefront records across all businesses. Contact details are masked and no store credentials are shown."
        badge="Read only"
      />

      <Alert variant="info" title="Published products">
        Counts include only active products that a business marked as storefront visible.
      </Alert>

      <SectionCard
        title="Storefront directory"
        description="Search by store, business, slug or country is limited to storefront and business names."
      >
        <form
          className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
          }}
        >
          <FormField
            className="flex-1"
            label="Search storefronts"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Store or business name"
          />
          <button
            type="submit"
            className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Search
          </button>
        </form>

        <ResourcePanel
          state={state}
          icon={Store}
          emptyTitle="No storefronts found"
          emptyDescription="Businesses without a published store do not appear here."
        >
          <DataTable columns={columns} rows={state.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
