import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Building2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import {
  searchCustomers,
  toCustomerServiceError,
} from '../../services/customerService';
import { formatDate } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_SORT_OPTIONS,
  getCustomerInitials,
} from './customerUtils';

export default function CustomersPage() {
  const location = useLocation();
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const [filters, setFilters] = useState({
    search: '',
    sort: 'name',
    direction: 'asc',
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(() => location.state?.message ?? '');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
      setPage(1);
      setLoading(true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filters.search]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;

    if (!businessId) return undefined;

    searchCustomers({
      businessId,
      search: debouncedSearch,
      page,
      pageSize: CUSTOMER_PAGE_SIZE,
      sort: filters.sort,
      direction: filters.direction,
    })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setCustomers(result.data);
        setTotal(result.count);
        setError('');
      })
      .catch((loadError) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(toCustomerServiceError(loadError).message);
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    businessId,
    debouncedSearch,
    filters.sort,
    filters.direction,
    page,
  ]);

  const updateFilter = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
    setLoading(true);
  }, []);

  const toggleDirection = () => {
    setFilters((current) => ({
      ...current,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setPage(1);
    setLoading(true);
  };

  const clearFilters = () => {
    setFilters({ search: '', sort: 'name', direction: 'asc' });
    setDebouncedSearch('');
    setPage(1);
    setLoading(true);
  };

  const changePage = (nextPage) => {
    setLoading(true);
    setPage(nextPage);
  };

  const hasFilters =
    Boolean(filters.search) ||
    filters.sort !== 'name' ||
    filters.direction !== 'asc';
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));

  return (
    <section className="space-y-6" aria-labelledby="customers-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="customers-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Customers
            </h2>
            <Badge variant="brand">Live records</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Keep the people and businesses you serve in one organised record,
            ready to link to conversations and orders.
          </p>
        </div>

        <Link
          to="/customers/new"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add customer
        </Link>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? (
        <Alert variant="success">
          <div className="flex items-start justify-between gap-3">
            <span>{success}</span>
            <button
              type="button"
              className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
              onClick={() => setSuccess('')}
            >
              Dismiss
            </button>
          </div>
        </Alert>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end">
          <FormField
            id="customer-search"
            label="Search customers"
            type="search"
            placeholder="Name, company, email, phone or address"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            trailing={<Search className="h-4 w-4 text-slate-400" aria-hidden="true" />}
          />
          <SelectField
            id="customer-sort"
            label="Sort by"
            value={filters.sort}
            onChange={(event) => updateFilter('sort', event.target.value)}
            options={CUSTOMER_SORT_OPTIONS}
            placeholder="Customer name"
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={toggleDirection}
              className="h-10"
              aria-label={`Sort ${filters.direction === 'asc' ? 'descending' : 'ascending'}`}
            >
              <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
              {filters.direction === 'asc' ? 'A-Z' : 'Z-A'}
            </Button>
            <Button
              variant="ghost"
              onClick={clearFilters}
              disabled={!hasFilters}
              className="h-10"
            >
              Clear
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {loading
            ? 'Loading customers...'
            : `${total} customer${total === 1 ? '' : 's'} in this workspace`}
        </p>
        {loading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-slate-400"
            aria-label="Loading customers"
          />
        ) : null}
      </div>

      {!loading && customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? 'No customers match these filters' : 'No customers yet'}
          description={
            hasFilters
              ? 'Clear the search or change the sort order.'
              : 'Add a customer manually, then link them to future conversations and orders.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link
                to="/customers/new"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add customer
              </Link>
            )
          }
        />
      ) : null}

      {customers.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {customers.map((customer) => (
            <article
              key={customer.id}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                  {getCustomerInitials(customer.fullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-slate-900">
                    {customer.fullName}
                  </h3>
                  {customer.companyName ? (
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
                      <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {customer.companyName}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-400">Individual customer</p>
                  )}
                </div>
                <Badge variant={customer.addressCount > 0 ? 'success' : 'neutral'}>
                  {customer.addressCount} address
                  {customer.addressCount === 1 ? '' : 'es'}
                </Badge>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                {customer.email ? (
                  <a
                    href={`mailto:${customer.email}`}
                    className="flex items-center gap-2 truncate text-slate-600 transition-colors hover:text-brand-700"
                  >
                    <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="truncate">{customer.email}</span>
                  </a>
                ) : null}
                {customer.phone ? (
                  <a
                    href={`tel:${customer.phone.replace(/\s+/g, '')}`}
                    className="flex items-center gap-2 truncate text-slate-600 transition-colors hover:text-brand-700"
                  >
                    <Phone className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="truncate">{customer.phone}</span>
                  </a>
                ) : null}
                {customer.primaryAddress ? (
                  <p className="flex items-start gap-2 text-slate-500">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="line-clamp-2">
                      {[
                        customer.primaryAddress.line1,
                        customer.primaryAddress.city,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-400">
                  Added {formatDate(customer.createdAt)}
                </p>
                <Link
                  to={`/customers/${customer.id}`}
                  className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
                >
                  View customer
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm sm:flex-row">
          <p className="text-slate-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => changePage(Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => changePage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
