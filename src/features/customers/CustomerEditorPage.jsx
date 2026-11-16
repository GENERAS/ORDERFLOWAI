import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Loader2,
  Mail,
  Phone,
  Save,
  UserRound,
  Users,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { SelectField } from '../../components/ui/SelectField';
import { controlClasses, labelClasses } from '../../components/ui/formStyles';
import {
  createCustomer,
  findCustomerDuplicates,
  getCustomer,
  toCustomerServiceError,
  updateCustomer,
} from '../../services/customerService';
import { cn } from '../../utils/cn';
import { useAuth } from '../auth/authContext';
import {
  canOverrideCustomerDuplicates,
  customerValuesFromRecord,
  CUSTOMER_STATUS_OPTIONS,
  DUPLICATE_REASON_LABELS,
  EMPTY_CUSTOMER_FORM,
  getCustomerInitials,
  parseCustomerTags,
} from './customerUtils';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCustomer(form) {
  const errors = {};
  if (!form.fullName.trim()) {
    errors.fullName = 'Enter the customer name.';
  }
  if (!form.email.trim() && !form.phone.trim()) {
    errors.contact = 'Add an email address or phone number.';
  }
  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }

  if (!CUSTOMER_STATUS_OPTIONS.some((option) => option.value === form.status)) {
    errors.status = 'Choose a customer status.';
  }

  const tags = parseCustomerTags(form.tags);
  if (tags.length > 20) {
    errors.tags = 'Add no more than 20 tags.';
  } else if (tags.some((tag) => tag.length > 40)) {
    errors.tags = 'Each tag must be 40 characters or fewer.';
  }

  return errors;
}

export default function CustomerEditorPage() {
  const { customerId } = useParams();
  const isNew = !customerId;
  const navigate = useNavigate();
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const canOverrideDuplicate = canOverrideCustomerDuplicates(
    activeMembership?.role,
  );

  const [form, setForm] = useState(EMPTY_CUSTOMER_FORM);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [duplicates, setDuplicates] = useState([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicateOverride, setDuplicateOverride] = useState(false);
  const [duplicateReason, setDuplicateReason] = useState('');

  useEffect(() => {
    let active = true;
    if (!businessId || !customerId) return undefined;

    getCustomer({ businessId, customerId })
      .then(({ customer: loadedCustomer }) => {
        if (!active) return;
        if (!loadedCustomer) {
          setError('This customer could not be found.');
          return;
        }
        setCustomer(loadedCustomer);
        setForm(customerValuesFromRecord(loadedCustomer));
        setError('');
      })
      .catch((loadError) => {
        if (active) setError(toCustomerServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId, customerId]);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(async () => {
      const fullName = form.fullName.trim();
      const email = form.email.trim();
      const phone = form.phone.trim();

      if (!businessId || (!fullName && !email && !phone)) {
        setDuplicates([]);
        setCheckingDuplicates(false);
        return;
      }

      setCheckingDuplicates(true);
      try {
        const matches = await findCustomerDuplicates({
          businessId,
          fullName,
          email,
          phone,
          excludeCustomerId: customerId ?? null,
        });
        if (active) setDuplicates(matches);
      } catch (duplicateError) {
        if (active) setError(toCustomerServiceError(duplicateError).message);
      } finally {
        if (active) setCheckingDuplicates(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [businessId, customerId, form.fullName, form.email, form.phone]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, contact: undefined }));
    setError('');
  };

  const hasBlockingDuplicate = duplicates.some(
    (match) =>
      match.matchReasons.includes('email') || match.matchReasons.includes('phone'),
  );
  const parsedTags = parseCustomerTags(form.tags);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validateCustomer(form);
    setErrors(nextErrors);
    setError('');

    if (Object.keys(nextErrors).length > 0) return;

    const overrideDuplicate = hasBlockingDuplicate && duplicateOverride;

    if (hasBlockingDuplicate && !overrideDuplicate) {
      setError(
        'Another customer already uses this email or phone. Open the existing record, use different contact details, or have an owner, admin or manager override the check.',
      );
      return;
    }

    if (overrideDuplicate && duplicateReason.trim().length < 3) {
      setError('Add a short reason for overriding the duplicate check.');
      return;
    }

    setSaving(true);

    const profile = {
      fullName: form.fullName,
      companyName: form.companyName,
      email: form.email,
      phone: form.phone,
      status: form.status,
      tags: parseCustomerTags(form.tags),
      duplicateOverride: overrideDuplicate,
      duplicateReason: overrideDuplicate ? duplicateReason : '',
    };

    try {
      const saved = isNew
        ? await createCustomer({
            businessId,
            ...profile,
            notes: form.notes,
          })
        : await updateCustomer({
            customerId,
            ...profile,
          });

      navigate(`/customers/${saved.id}`, {
        state: {
          message: isNew
            ? `${saved.fullName} was added to your customers.`
            : `${saved.fullName} was updated.`,
        },
      });
    } catch (saveError) {
      setError(toCustomerServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  if (!isNew && !customer && error) {
    return (
      <section className="space-y-4">
        <Link
          to="/customers"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to customers
        </Link>
        <Alert variant="error">{error}</Alert>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="customer-editor-title">
      <div>
        <Link
          to={isNew ? '/customers' : `/customers/${customerId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {isNew ? 'Back to customers' : 'Back to customer'}
        </Link>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="customer-editor-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              {isNew ? 'Add customer' : 'Edit customer'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
              {isNew
                ? 'Create a customer record with at least one contact method. Addresses can be added after saving.'
                : 'Update the customer profile. Existing addresses are managed separately on the customer record.'}
            </p>
          </div>
          <Badge variant="neutral">{activeBusiness?.name}</Badge>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Customer profile</CardTitle>
              <CardDescription>
                Contact details are stored only inside this workspace and protected by
                tenant access rules.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="customer-name"
                  label="Full name"
                  value={form.fullName}
                  onChange={(event) => updateField('fullName', event.target.value)}
                  placeholder="e.g. Aline Mukamana"
                  autoComplete="name"
                  required
                  error={errors.fullName}
                  trailing={<UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                />
                <FormField
                  id="customer-company"
                  label="Company"
                  value={form.companyName}
                  onChange={(event) => updateField('companyName', event.target.value)}
                  placeholder="Optional business name"
                  autoComplete="organization"
                  trailing={<Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                />
                <FormField
                  id="customer-email"
                  label="Email address"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  placeholder="customer@example.com"
                  autoComplete="email"
                  error={errors.email ?? errors.contact}
                  hint="Use at least one phone number or email address."
                  trailing={<Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                />
                <FormField
                  id="customer-phone"
                  label="Phone number"
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                  placeholder="+250 788 123 456"
                  autoComplete="tel"
                  error={errors.contact}
                  trailing={<Phone className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="customer-status"
                  label="Status"
                  value={form.status}
                  onChange={(event) => updateField('status', event.target.value)}
                  options={CUSTOMER_STATUS_OPTIONS}
                  placeholder="Select status"
                  error={errors.status}
                  required
                />
                <FormField
                  id="customer-tags"
                  label="Tags"
                  value={form.tags}
                  onChange={(event) => updateField('tags', event.target.value)}
                  placeholder="vip, wholesale, follow-up"
                  error={errors.tags}
                  hint="Separate tags with commas. Tags are saved in lowercase."
                />
              </div>

              {parsedTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {parsedTags.map((tag) => (
                    <Badge key={tag} variant="brand">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {isNew ? (
                <div>
                  <label htmlFor="customer-notes" className={labelClasses}>
                    Initial note
                  </label>
                  <textarea
                    id="customer-notes"
                    rows={4}
                    value={form.notes}
                    onChange={(event) => updateField('notes', event.target.value)}
                    placeholder="Preferences, delivery instructions or other useful context"
                    className={cn(controlClasses, 'mt-1.5 min-h-28 resize-y')}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    This becomes the first note in the customer timeline. Up to 2,000
                    characters.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
                <Link
                  to={isNew ? '/customers' : `/customers/${customerId}`}
                  className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  Cancel
                </Link>
                <Button
                  type="submit"
                  disabled={saving}
                  className="min-w-36"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isNew ? 'Add customer' : 'Save changes'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Duplicate check</CardTitle>
                <CardDescription>
                  We check exact email, phone and name matches before saving.
                </CardDescription>
              </div>
              {checkingDuplicates ? (
                <Loader2
                  className="h-4 w-4 animate-spin text-slate-400"
                  aria-label="Checking for duplicates"
                />
              ) : null}
            </CardHeader>
            <CardContent>
              {duplicates.length === 0 ? (
                <div className="flex items-start gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-sm text-slate-500">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <p>
                    {checkingDuplicates
                      ? 'Checking existing customers...'
                      : 'No duplicate matches found yet.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {hasBlockingDuplicate ? (
                    <Alert variant="warning" title="Possible duplicate">
                      This email or phone is already attached to another customer.
                    </Alert>
                  ) : (
                    <Alert variant="info">
                      The same name exists. This is only a warning unless the email or
                      phone also matches.
                    </Alert>
                  )}

                  {hasBlockingDuplicate && canOverrideDuplicate ? (
                    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-3">
                      <label
                        htmlFor="customer-duplicate-override"
                        className="flex cursor-pointer items-start gap-3"
                      >
                        <input
                          id="customer-duplicate-override"
                          type="checkbox"
                          checked={duplicateOverride}
                          onChange={(event) => {
                            setDuplicateOverride(event.target.checked);
                            setError('');
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span className="text-sm text-slate-700">
                          <span className="block font-medium text-slate-800">
                            Override duplicate check
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            Owners, admins and managers can keep separate profiles that
                            share contact details. The override is recorded in the
                            customer timeline.
                          </span>
                        </span>
                      </label>

                      {duplicateOverride ? (
                        <FormField
                          id="customer-duplicate-reason"
                          label="Override reason"
                          value={duplicateReason}
                          onChange={(event) => {
                            setDuplicateReason(event.target.value);
                            setError('');
                          }}
                          placeholder="Why should this duplicate be allowed?"
                          hint="Between 3 and 240 characters."
                          required
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {hasBlockingDuplicate && !canOverrideDuplicate ? (
                    <p className="text-xs text-slate-500">
                      Only owners, admins and managers can override duplicate contact
                      details.
                    </p>
                  ) : null}

                  <ul className="space-y-2">
                    {duplicates.map((match) => (
                      <li
                        key={match.id}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-3"
                      >
                        <div className="flex items-start gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                            {getCustomerInitials(match.fullName)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/customers/${match.id}`}
                              className="truncate text-sm font-medium text-slate-900 hover:text-brand-700"
                            >
                              {match.fullName}
                            </Link>
                            {match.companyName ? (
                              <p className="truncate text-xs text-slate-500">
                                {match.companyName}
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {match.matchReasons.map((reason) => (
                                <Badge
                                  key={reason}
                                  variant={reason === 'name' ? 'neutral' : 'warning'}
                                >
                                  {DUPLICATE_REASON_LABELS[reason] ?? reason}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Alert variant="info" title="Privacy">
            Customer records are visible only to active members of this workspace.
            Keep only the information your business needs.
          </Alert>
        </div>
      </div>
    </section>
  );
}
