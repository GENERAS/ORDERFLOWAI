import { useMemo, useRef, useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
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
import { SelectField } from '../../components/ui/SelectField';
import { SetupShell } from '../../components/layout/SetupShell';
import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  getBrowserTimeZone,
  INDUSTRY_OPTIONS,
  TIMEZONE_OPTIONS,
} from '../../config/businessOptions';
import { useAuth } from '../auth/authContext';
import { createBusiness } from '../../services/authService';
import { createWorkspaceSlug } from '../../utils/slug';
import {
  isValidBusinessName,
  isValidBusinessSlug,
} from '../../utils/validation';

function createSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { memberships, refreshMemberships } = useAuth();
  const submittingRef = useRef(false);
  const [suffix, setSuffix] = useState(createSuffix);
  const [form, setForm] = useState({
    name: '',
    industry: '',
    country: '',
    currency: '',
    timezone: getBrowserTimeZone(),
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const workspaceSlug = useMemo(
    () => createWorkspaceSlug(form.name, suffix),
    [form.name, suffix],
  );

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  };

  const validate = () => {
    const nextErrors = {};
    if (!isValidBusinessName(form.name)) {
      nextErrors.name = 'Enter a business name (up to 160 characters).';
    }
    if (!form.country) nextErrors.country = 'Select a country.';
    if (!form.currency) nextErrors.currency = 'Select a currency.';
    if (!form.timezone) nextErrors.timezone = 'Select a timezone.';
    if (!isValidBusinessSlug(workspaceSlug)) {
      nextErrors.name = 'Use a name that produces a valid workspace identifier.';
    }
    return nextErrors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length > 0) return;

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const business = await createBusiness({
        name: form.name,
        slug: workspaceSlug,
        industry: form.industry || null,
        country: form.country,
        currency: form.currency,
        timezone: form.timezone,
      });

      if (!business?.id) {
        throw new Error('The workspace was created but could not be loaded.');
      }

      await refreshMemberships({ activateBusinessId: business.id });
      navigate('/overview', { replace: true });
    } catch (error) {
      if (error.code === '23505') {
        try {
          const currentMemberships = await refreshMemberships();
          const existing = currentMemberships.find(
            (membership) => membership.business.slug === workspaceSlug,
          );

          if (existing) {
            await refreshMemberships({
              activateBusinessId: existing.business.id,
            });
            navigate('/overview', { replace: true });
            return;
          }
        } catch (refreshError) {
          setFormError(refreshError.message);
          return;
        }

        setFormError(
          'That workspace identifier is already taken. Change the business name slightly and try again.',
        );
        setSuffix(createSuffix());
        return;
      }

      setFormError(error.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SetupShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge variant="brand">
            <Building2 className="h-3 w-3" aria-hidden="true" />
            Workspace setup
          </Badge>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            Set up your business workspace
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
            Add the essentials for your business. You can refine these settings later from
            the workspace settings page.
          </p>
        </div>

        {memberships.length > 0 ? (
          <Link
            to="/overview"
            className="text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            Back to workspace
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle as="h2">Business details</CardTitle>
            <CardDescription>
              These values drive currency, dates and reporting across the workspace.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            {formError ? <Alert variant="error">{formError}</Alert> : null}

            <FormField
              id="business-name"
              label="Business name"
              autoComplete="organization"
              value={form.name}
              onChange={updateField('name')}
              error={errors.name}
              required
              placeholder="e.g. Acme Retail"
              maxLength={160}
              hint={`Workspace identifier: ${workspaceSlug}`}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                id="business-industry"
                label="Industry"
                value={form.industry}
                onChange={updateField('industry')}
                options={INDUSTRY_OPTIONS}
                placeholder="Select an industry (optional)"
                hint="Optional. Helps tailor future workflows."
              />

              <SelectField
                id="business-country"
                label="Country"
                value={form.country}
                onChange={updateField('country')}
                options={COUNTRY_OPTIONS}
                error={errors.country}
                required
                placeholder="Select a country"
              />

              <SelectField
                id="business-currency"
                label="Currency"
                value={form.currency}
                onChange={updateField('currency')}
                options={CURRENCY_OPTIONS}
                error={errors.currency}
                required
                placeholder="Select a currency"
              />

              <SelectField
                id="business-timezone"
                label="Timezone"
                value={form.timezone}
                onChange={updateField('timezone')}
                options={TIMEZONE_OPTIONS}
                error={errors.timezone}
                required
                placeholder="Select a timezone"
                hint="Used for order and report dates."
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-sm text-xs leading-relaxed text-slate-500">
                You will become the owner of this workspace. Team invitations arrive in a
                later phase.
              </p>
              <Button type="submit" size="lg" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {submitting ? 'Creating workspace…' : 'Create workspace'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </SetupShell>
  );
}
