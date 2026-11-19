import { useEffect, useState } from 'react';
import { Bot, CreditCard, ExternalLink, Globe2, Loader2, Save, Settings2, BellRing } from 'lucide-react';
import { Link } from 'react-router-dom';
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
import { SelectField } from '../../components/ui/SelectField';
import { formatCurrency } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  getWorkspaceSettings,
  getWorkspaceSubscription,
  toWorkspaceSettingsServiceError,
  updateWorkspaceSettings,
} from '../../services/workspaceSettingsService';

const initialForm = Object.freeze({
  name: '',
  industry: '',
  country: 'RW',
  currency: 'RWF',
  timezone: 'Africa/Kigali',
  notifyEmail: true,
  notifyNewOrders: true,
  notifyPayments: true,
  aiTone: 'concise',
  aiRequireConfirmation: true,
});

const AI_TONE_OPTIONS = Object.freeze([
  { value: 'concise', label: 'Concise' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
]);

function CheckboxField({ id, label, description, checked, onChange }) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const { activeBusiness, refreshMemberships } = useAuth();
  const businessId = activeBusiness?.id;
  const [form, setForm] = useState(initialForm);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    Promise.resolve().then(() => {
      if (active) setLoading(true);
    });
    Promise.all([
      getWorkspaceSettings(businessId),
      getWorkspaceSubscription(businessId),
    ])
      .then(([settings, currentSubscription]) => {
        if (!active) return;
        setForm({
          name: settings.name,
          industry: settings.industry ?? '',
          country: settings.country,
          currency: settings.currency,
          timezone: settings.timezone,
          notifyEmail: settings.notifyEmail,
          notifyNewOrders: settings.notifyNewOrders,
          notifyPayments: settings.notifyPayments,
          aiTone: settings.aiTone,
          aiRequireConfirmation: settings.aiRequireConfirmation,
        });
        setSubscription(currentSubscription);
        setError('');
      })
      .catch((loadError) => {
        if (active) setError(toWorkspaceSettingsServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSuccess('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!businessId) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const saved = await updateWorkspaceSettings(businessId, form);
      setForm({
        name: saved.name,
        industry: saved.industry ?? '',
        country: saved.country,
        currency: saved.currency,
        timezone: saved.timezone,
        notifyEmail: saved.notifyEmail,
        notifyNewOrders: saved.notifyNewOrders,
        notifyPayments: saved.notifyPayments,
        aiTone: saved.aiTone,
        aiRequireConfirmation: saved.aiRequireConfirmation,
      });
      setSuccess('Workspace settings saved.');
      await refreshMemberships();
    } catch (saveError) {
      setError(toWorkspaceSettingsServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  if (!businessId) {
    return (
      <EmptyState
        icon={Settings2}
        title="No workspace selected"
        description="Choose a workspace to manage its settings."
      />
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="settings-title">
      <div>
        <h1
          id="settings-title"
          className="text-2xl font-bold tracking-tight text-slate-900"
        >
          Business settings
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Manage your workspace profile, notification preferences, assistant
          behaviour and local subscription record.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading settings...
        </div>
      ) : null}

      {error ? <Alert variant="error" title="Could not load settings">{error}</Alert> : null}
      {success ? <Alert variant="success" title="Settings saved">{success}</Alert> : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Business profile</CardTitle>
              <CardDescription>
                These details identify the workspace and set the defaults used
                by new records.
              </CardDescription>
            </div>
            <Globe2 className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="settings-name"
              label="Business name"
              value={form.name}
              required
              onChange={(event) => updateField('name', event.target.value)}
            />
            <FormField
              id="settings-industry"
              label="Industry"
              value={form.industry}
              onChange={(event) => updateField('industry', event.target.value)}
            />
            <FormField
              id="settings-country"
              label="Country code"
              value={form.country}
              maxLength={2}
              onChange={(event) => updateField('country', event.target.value.toUpperCase())}
            />
            <FormField
              id="settings-currency"
              label="Currency code"
              value={form.currency}
              maxLength={3}
              onChange={(event) => updateField('currency', event.target.value.toUpperCase())}
            />
            <FormField
              id="settings-timezone"
              label="Timezone"
              value={form.timezone}
              className="sm:col-span-2"
              onChange={(event) => updateField('timezone', event.target.value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Notifications</CardTitle>
              <CardDescription>
                Control which workspace events should be highlighted in the
                app and prepared for delivery.
              </CardDescription>
            </div>
            <BellRing className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <CheckboxField
              id="notify-email"
              label="Email notifications"
              description="Include account and workspace alerts by email."
              checked={form.notifyEmail}
              onChange={(value) => updateField('notifyEmail', value)}
            />
            <CheckboxField
              id="notify-orders"
              label="New orders"
              description="Highlight newly submitted and pending orders."
              checked={form.notifyNewOrders}
              onChange={(value) => updateField('notifyNewOrders', value)}
            />
            <CheckboxField
              id="notify-payments"
              label="Payment activity"
              description="Highlight recorded, verified and rejected payments."
              checked={form.notifyPayments}
              onChange={(value) => updateField('notifyPayments', value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Assistant behaviour</CardTitle>
              <CardDescription>
                The assistant uses real catalogue and order data only. It never
                approves orders or changes stock by itself.
              </CardDescription>
            </div>
            <Bot className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="ai-tone"
              label="Response tone"
              value={form.aiTone}
              options={AI_TONE_OPTIONS}
              onChange={(event) => updateField('aiTone', event.target.value)}
            />
            <div className="flex items-end">
              <CheckboxField
                id="ai-confirmation"
                label="Require customer confirmation"
                description="Prepared orders wait for customer confirmation before approval."
                checked={form.aiRequireConfirmation}
                onChange={(value) => updateField('aiRequireConfirmation', value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Subscription</CardTitle>
              <CardDescription>
                Local plan record for this workspace. No live payment gateway
                or subscription billing is connected.
              </CardDescription>
            </div>
            <CreditCard className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {subscription ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-semibold text-slate-900">
                    {subscription.planName}
                  </span>
                  <Badge variant="success">{subscription.status}</Badge>
                  <span className="text-sm text-slate-500">
                    {formatCurrency(subscription.monthlyAmount, {
                      currency: subscription.currency,
                    })}
                    /month
                  </span>
                </div>
                {subscription.features.length ? (
                  <ul className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                    {subscription.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No subscription record is available for this workspace.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Online store</CardTitle>
              <CardDescription>
                Manage the public storefront name, description, logo, contact
                details and product visibility.
              </CardDescription>
            </div>
            <ExternalLink className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <Link
              to="/store"
              className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Manage online store
            </Link>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || loading}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Save settings
          </Button>
        </div>
      </form>
    </section>
  );
}
