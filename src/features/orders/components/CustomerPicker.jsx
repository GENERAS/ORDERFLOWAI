import { useEffect, useState } from 'react';
import { Building2, Loader2, Mail, Phone, Search, UserRound } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import { searchCustomers, toCustomerServiceError } from '../../../services/customerService';
import { getCustomerInitials } from '../../customers/customerUtils';

export function CustomerPicker({ businessId, selectedCustomer, onSelect }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let active = true;
    if (!businessId || selectedCustomer) return undefined;

    const timeout = window.setTimeout(() => {
      setLoading(true);
      searchCustomers({
        businessId,
        search: debouncedSearch,
        page: 1,
        pageSize: 8,
        sort: 'name',
        direction: 'asc',
      })
        .then((result) => {
          if (!active) return;
          setCustomers(result.data);
          setError('');
        })
        .catch((loadError) => {
          if (active) setError(toCustomerServiceError(loadError).message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [businessId, debouncedSearch, selectedCustomer]);

  if (selectedCustomer) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
              {getCustomerInitials(selectedCustomer.fullName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {selectedCustomer.fullName}
              </p>
              {selectedCustomer.companyName ? (
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
                  <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {selectedCustomer.companyName}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                {selectedCustomer.email ? (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    {selectedCustomer.email}
                  </span>
                ) : null}
                {selectedCustomer.phone ? (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    {selectedCustomer.phone}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onSelect(null)}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FormField
        id="order-customer-search"
        label="Find a customer"
        type="search"
        placeholder="Name, company, email or phone"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        trailing={
          loading ? (
            <Loader2
              className="h-4 w-4 animate-spin text-slate-400"
              aria-label="Searching customers"
            />
          ) : (
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
          )
        }
      />

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
        {customers.length === 0 && !loading ? (
          <div className="px-4 py-8 text-center">
            <UserRound
              className="mx-auto h-6 w-6 text-slate-300"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-slate-500">
              {debouncedSearch
                ? 'No customers match this search.'
                : 'No customers yet. Add a customer first.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {customers.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => onSelect(customer)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {getCustomerInitials(customer.fullName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {customer.fullName}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {[customer.companyName, customer.phone, customer.email]
                        .filter(Boolean)
                        .join(' - ') || 'No contact details'}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-700">
                    Select
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
