import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Save, ShieldCheck } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { SelectField } from '../../components/ui/SelectField';
import { formatDate } from './platformFormatters';
import {
  fetchPlatformGrants,
  fetchPlatformPermissions,
  fetchPlatformSettings,
  grantPlatformPermission,
  revokePlatformPermission,
  updatePlatformSetting,
} from './platformService';
import {
  DataTable,
  PageIntro,
  ResourcePanel,
  SectionCard,
} from './platformUi';

const initialGrantForm = Object.freeze({ email: '', permission: '', reason: '' });

function asState(status, rows, error) {
  return { status, rows, error };
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState({ status: 'loading', data: null, error: null });
  const [grants, setGrants] = useState(asState('loading', [], null));
  const [permissions, setPermissions] = useState(asState('loading', [], null));
  const [bytes, setBytes] = useState('');
  const [grantForm, setGrantForm] = useState(initialGrantForm);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async ({ includeSettings = false } = {}) => {
    const [grantsResult, permissionsResult, settingsResult] = await Promise.allSettled([
      fetchPlatformGrants(),
      fetchPlatformPermissions(),
      includeSettings ? fetchPlatformSettings() : Promise.resolve(null),
    ]);

    const normalized = (result) =>
      result.status === 'fulfilled'
        ? asState('ready', result.value ?? [], null)
        : asState('error', [], result.reason?.message ?? 'Unable to load data.');

    setGrants(normalized(grantsResult));
    setPermissions(normalized(permissionsResult));

    if (includeSettings) {
      if (settingsResult.status === 'fulfilled') {
        const data = settingsResult.value ?? {};
        setSettings({ status: 'ready', data, error: null });
        setBytes(String(data.media_max_file_bytes ?? ''));
      } else {
        setSettings({
          status: 'error',
          data: null,
          error: settingsResult.reason?.message ?? 'Unable to load platform settings.',
        });
      }
    }
  }, []);

  useEffect(() => {
    Promise.resolve()
      .then(() => load({ includeSettings: true }))
      .catch((error) => {
        setActionError(error.message ?? 'Unable to load platform settings.');
      });
  }, [load]);

  async function handleSettingSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await updatePlatformSetting({ key: 'media.max_file_bytes', value: bytes.trim() });
      await load({ includeSettings: true });
      setNotice('Upload limit updated and audited.');
    } catch (error) {
      setActionError(error.message ?? 'Unable to update the platform setting.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGrantSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await grantPlatformPermission(grantForm);
      setGrantForm(initialGrantForm);
      await load();
      setNotice('Platform permission granted and audited.');
    } catch (error) {
      setActionError(error.message ?? 'Unable to grant the permission.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(grantId) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await revokePlatformPermission({
        grantId,
        reason: 'Revoked from the platform console',
      });
      await load();
      setNotice('Platform permission revoked and audited.');
    } catch (error) {
      setActionError(error.message ?? 'Unable to revoke the permission.');
    } finally {
      setBusy(false);
    }
  }

  const permissionOptions = permissions.rows.map((row) => ({
    value: row.code,
    label: `${row.label} (${row.code})`,
  }));

  const grantColumns = [
    {
      key: 'user',
      label: 'Account',
      render: (row) => (
        <div className="min-w-0">
          <p className="text-sm text-slate-900">{row.email_masked ?? 'Unknown account'}</p>
          <p className="font-mono text-xs text-slate-400">{row.user_id.slice(0, 8)}</p>
        </div>
      ),
    },
    {
      key: 'access',
      label: 'Access',
      render: (row) => (
        <span className="text-xs">{row.permission_code ?? row.role_code ?? '—'}</span>
      ),
    },
    {
      key: 'business',
      label: 'Scoped to',
      render: (row) => <span className="text-xs">{row.business_name ?? 'All businesses'}</span>,
    },
    {
      key: 'granted',
      label: 'Granted',
      render: (row) => <span className="text-xs">{formatDate(row.created_at)}</span>,
    },
    {
      key: 'expires',
      label: 'Expires',
      render: (row) => <span className="text-xs">{formatDate(row.expires_at)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Badge variant={row.revoked_at ? 'neutral' : 'success'}>
          {row.revoked_at ? 'Revoked' : 'Active'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) =>
        row.revoked_at ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => handleRevoke(row.id)}
          >
            Revoke
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageIntro
        title="Platform settings"
        description="Configuration that can be changed from the console, plus audited platform permission grants. Credentials are never exposed or edited here."
        badge="Restricted"
      />

      {actionError ? (
        <Alert variant="error" title="Action failed">
          {actionError}
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success" title="Done">
          {notice}
        </Alert>
      ) : null}

      <SectionCard
        title="Media upload limit"
        description="Maximum permitted size for a single media asset, in bytes."
      >
        {settings.status === 'loading' ? <PageLoader /> : null}
        {settings.status === 'error' ? (
          <Alert variant="error" title="Settings unavailable">
            {settings.error}
          </Alert>
        ) : null}
        {settings.status === 'ready' ? (
          <>
            <p className="mb-4 text-sm text-slate-500">
              Provider: <span className="font-medium text-slate-700">{settings.data?.media_provider ?? '—'}</span>
              {' · '}Types:{' '}
              <span className="font-medium text-slate-700">
                {(settings.data?.media_allowed_mime_types ?? []).join(', ') || '—'}
              </span>
            </p>
            <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={handleSettingSubmit}>
              <FormField
                className="flex-1"
                label="Max file bytes"
                type="number"
                min={1024}
                max={52428800}
                step={1}
                required
                value={bytes}
                onChange={(event) => setBytes(event.target.value)}
                hint="Between 1,024 and 52,428,800 bytes."
              />
              <Button type="submit" disabled={busy}>
                <Save className="h-4 w-4" aria-hidden="true" />
                Save setting
              </Button>
            </form>
          </>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Platform permission grants"
        description="Grant and revoke scoped platform access. Every change is written to the audit log."
      >
        <form
          className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={handleGrantSubmit}
        >
          <FormField
            label="Account email"
            type="email"
            required
            value={grantForm.email}
            onChange={(event) =>
              setGrantForm((previous) => ({ ...previous, email: event.target.value }))
            }
            placeholder="user@example.com"
          />
          <SelectField
            label="Permission"
            required
            value={grantForm.permission}
            onChange={(event) =>
              setGrantForm((previous) => ({ ...previous, permission: event.target.value }))
            }
            options={permissionOptions}
            placeholder="Select a permission"
          />
          <Button type="submit" disabled={busy} className="self-end">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Grant
          </Button>
          <FormField
            className="md:col-span-3"
            label="Reason"
            value={grantForm.reason}
            onChange={(event) =>
              setGrantForm((previous) => ({ ...previous, reason: event.target.value }))
            }
            placeholder="Why this access is needed"
            maxLength={500}
          />
        </form>

        <div className="mt-5">
          <ResourcePanel
            state={grants}
            icon={ShieldCheck}
            emptyTitle="No platform grants"
            emptyDescription="No explicit platform permission grants have been recorded."
          >
            <DataTable columns={grantColumns} rows={grants.rows} />
          </ResourcePanel>
        </div>
      </SectionCard>
    </div>
  );
}
