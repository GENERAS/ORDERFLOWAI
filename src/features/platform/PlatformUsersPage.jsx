import { useEffect, useState } from 'react';
import { Search, UsersRound } from 'lucide-react';
import { FormField } from '../../components/ui/FormField';
import { formatCount, formatDate, formatLabel } from './platformFormatters';
import { fetchPlatformUsers } from './platformService';
import {
  DataTable,
  PageIntro,
  ResourcePanel,
  SectionCard,
  StateBadge,
} from './platformUi';

const columns = [
  {
    key: 'user',
    label: 'User',
    render: (row) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{row.full_name || 'Unnamed profile'}</p>
        <p className="font-mono text-xs text-slate-400">{row.id.slice(0, 8)}</p>
      </div>
    ),
  },
  {
    key: 'email',
    label: 'Email',
    render: (row) => <span className="text-xs">{row.email_masked ?? '—'}</span>,
  },
  {
    key: 'roles',
    label: 'Workspace roles',
    render: (row) => <span className="text-xs">{formatLabel(row.role_summary)}</span>,
  },
  {
    key: 'businesses',
    label: 'Workspaces',
    render: (row) => formatCount(row.business_count),
  },
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StateBadge value={row.status} />,
  },
  {
    key: 'last_sign_in',
    label: 'Last sign-in',
    render: (row) => <span className="text-xs">{formatDate(row.last_sign_in_at)}</span>,
  },
  {
    key: 'joined',
    label: 'Registered',
    render: (row) => <span className="text-xs">{formatDate(row.created_at)}</span>,
  },
];

export default function PlatformUsersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });

  useEffect(() => {
    let active = true;

    Promise.resolve()
      .then(() => {
        setState((previous) => ({ ...previous, status: 'loading', error: null }));
        return fetchPlatformUsers({ search: query });
      })
      .then((rows) => {
        if (active) setState({ status: 'ready', rows, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({ status: 'error', rows: [], error: error.message ?? 'Unable to load users.' });
        }
      });

    return () => {
      active = false;
    };
  }, [query]);

  return (
    <div className="space-y-6">
      <PageIntro
        title="Users & staff"
        description="Platform-wide account directory. Email addresses are masked; no credentials or tokens are exposed."
        badge="Read only"
      />

      <SectionCard
        title="Account directory"
        description="Search by name, email or profile ID."
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
            label="Search users"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or profile ID"
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
          icon={UsersRound}
          emptyTitle="No users found"
          emptyDescription="Try a different search term or check back after accounts are created."
        >
          <DataTable columns={columns} rows={state.rows} />
        </ResourcePanel>
      </SectionCard>
    </div>
  );
}
