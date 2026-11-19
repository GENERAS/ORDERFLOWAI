import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Search, ShieldAlert } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { SelectField } from '../../components/ui/SelectField';
import { useAuth } from '../auth/authContext';
import { toAuthServiceError } from '../../services/authService';
import {
  endPlatformSupportSession,
  fetchPlatformBusinesses,
  fetchPlatformSupportSessions,
  startPlatformSupportSession,
} from './platformService';

const numberFormatter = new Intl.NumberFormat();

const initialForm = Object.freeze({
  purpose: '',
  durationMinutes: 30,
  role: '',
});

const supportRoles = Object.freeze([
  { value: 'staff', label: 'Staff' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
]);

function formatCount(value) {
  return numberFormatter.format(Number(value ?? 0));
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function StatusBadge({ status }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'inactive') return <Badge variant="warning">Inactive</Badge>;
  return <Badge variant="neutral">Missing</Badge>;
}

export default function PlatformBusinessesPage() {
  const navigate = useNavigate();
  const { platform, refreshPlatformAccess, activateSupportSession } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });
  const [sessions, setSessions] = useState([]);
  const [supportTarget, setSupportTarget] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const canStartSupport =
    Boolean(platform?.isSuperAdmin) ||
    Boolean(platform?.permissions?.includes('platform.support.access'));
  const canElevate =
    Boolean(platform?.isSuperAdmin) ||
    Boolean(platform?.permissions?.includes('platform.businesses.manage'));

  async function refreshData() {
    const [rows, activeSessions] = await Promise.all([
      fetchPlatformBusinesses({ search: query }),
      fetchPlatformSupportSessions(),
    ]);
    setState({ status: 'ready', rows, error: null });
    setSessions(activeSessions);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      setState((previous) => ({ ...previous, status: 'loading', error: null }));
      try {
        const [rows, activeSessions] = await Promise.all([
          fetchPlatformBusinesses({ search: query }),
          fetchPlatformSupportSessions(),
        ]);
        if (active) {
          setState({ status: 'ready', rows, error: null });
          setSessions(activeSessions);
        }
      } catch (error) {
        if (active) {
          setState({
            status: 'error',
            rows: [],
            error: toAuthServiceError(error).message,
          });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [query]);

  function openSupport(business) {
    setSupportTarget(business);
    setForm(initialForm);
    setActionError(null);
  }

  async function handleStartSupport(event) {
    event.preventDefault();
    if (!supportTarget || busy) return;

    setBusy(true);
    setActionError(null);
    try {
      const session = await startPlatformSupportSession({
        businessId: supportTarget.id,
        purpose: form.purpose,
        durationMinutes: form.durationMinutes,
        businessRoles: canElevate && form.role ? [form.role] : [],
      });
      activateSupportSession(session);
      await refreshPlatformAccess({ activateBusinessId: supportTarget.id });
      await refreshData();
      setSupportTarget(null);
      setForm(initialForm);
    } catch (error) {
      setActionError(toAuthServiceError(error).message);
    } finally {
      setBusy(false);
    }
  }

  function openWorkspace(session) {
    activateSupportSession(session);
    navigate(`/overview?support=${encodeURIComponent(session.id)}`);
  }

  async function handleEndSupport(session) {
    if (busy) return;

    setBusy(true);
    setActionError(null);
    try {
      await endPlatformSupportSession(session.id);
      await refreshPlatformAccess();
      await refreshData();
    } catch (error) {
      setActionError(toAuthServiceError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Businesses
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Platform-wide business directory with masked owner details. Support
            access is scoped, timed and audited.
          </p>
        </div>
        {canStartSupport ? (
          <Badge variant="brand">Support access available</Badge>
        ) : (
          <Badge variant="neutral">Directory only</Badge>
        )}
      </section>

      {actionError ? (
        <Alert variant="error" title="Support action failed">
          {actionError}
        </Alert>
      ) : null}

      {sessions.length > 0 ? (
        <Alert variant="warning" title="Active support sessions">
          <div className="mt-3 space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {session.business_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {session.purpose} · expires {formatDate(session.expires_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openWorkspace(session)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                  >
                    <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                    Open workspace
                  </button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => handleEndSupport(session)}
                  >
                    End access
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle as="h2">Business directory</CardTitle>
            <CardDescription>
              Search by business name, slug, country or ID.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="mb-5 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              setState((previous) => ({ ...previous, status: 'loading', error: null }));
              setQuery(search.trim());
            }}
          >
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search businesses"
                aria-label="Search businesses"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Search
            </button>
          </form>

          {state.status === 'loading' ? <PageLoader /> : null}

          {state.status === 'error' ? (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {state.error}
            </p>
          ) : null}

          {state.status === 'ready' && state.rows.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No businesses found"
              description="Try a different search term."
            />
          ) : null}

          {state.status === 'ready' && state.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-600">Business</th>
                    <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
                    <th className="px-4 py-3 font-semibold text-slate-600">Owner</th>
                    <th className="px-4 py-3 font-semibold text-slate-600">Products</th>
                    <th className="px-4 py-3 font-semibold text-slate-600">Orders</th>
                    <th className="px-4 py-3 font-semibold text-slate-600">WhatsApp</th>
                    <th className="px-4 py-3 font-semibold text-slate-600">Registered</th>
                    <th className="px-4 py-3 font-semibold text-slate-600">Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {state.rows.map((row) => {
                    const activeSession = sessions.find(
                      (session) => session.business_id === row.id,
                    );

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{row.name}</p>
                          <p className="text-xs text-slate-400">
                            {row.slug} · {row.country || '—'} · {row.currency}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.storefront_status} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.owner_email ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatCount(row.product_count)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatCount(row.order_count)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={row.whatsapp_connected ? 'success' : 'neutral'}>
                            {row.whatsapp_connected ? 'Connected' : 'Not connected'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          {activeSession ? (
                            <Badge variant="warning">Support active</Badge>
                          ) : canStartSupport ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => openSupport(row)}
                            >
                              Start support
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400">No access</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {supportTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="presentation"
          onClick={() => setSupportTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-support-title"
            className="w-full max-w-lg rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <form onSubmit={handleStartSupport}>
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                    <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2
                      id="start-support-title"
                      className="text-base font-semibold text-slate-900"
                    >
                      Start support access
                    </h2>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {supportTarget.name}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-5 py-5">
                <Alert variant="info" title="Audited, time-limited access">
                  Read-only business access is granted by default. The session expires
                  automatically and is recorded in the platform audit log.
                </Alert>

                <FormField
                  label="Purpose"
                  required
                  value={form.purpose}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      purpose: event.target.value,
                    }))
                  }
                  placeholder="Why support access is needed"
                  minLength={3}
                  maxLength={500}
                  hint="Use a specific support reason. It is stored in the audit log."
                />

                <SelectField
                  label="Duration"
                  value={String(form.durationMinutes)}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      durationMinutes: Number(event.target.value),
                    }))
                  }
                  options={[
                    { value: 15, label: '15 minutes' },
                    { value: 30, label: '30 minutes' },
                    { value: 60, label: '1 hour' },
                    { value: 120, label: '2 hours' },
                  ]}
                />

                {canElevate ? (
                  <SelectField
                    label="Business role"
                    value={form.role}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        role: event.target.value,
                      }))
                    }
                    options={supportRoles}
                    placeholder="No business role"
                    hint="Only grant a role when the task requires it. Role elevation is audited."
                  />
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setSupportTarget(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Starting…' : 'Start support'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
