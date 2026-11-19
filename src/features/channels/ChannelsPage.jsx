import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, Loader2, MessageCircle } from 'lucide-react';
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
import {
  connectWhatsApp,
  disconnectChannel,
  getMetaPublicConfig,
  listChannels,
  toCommunicationServiceError,
} from '../../services/communicationService';
import { formatDate, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import { launchWhatsAppEmbeddedSignup } from './embeddedSignup';

const MANAGER_ROLES = ['owner', 'admin', 'manager'];

function isChannelConnected(channel) {
  return Boolean(
    channel?.isConnected ?? ['connected', 'active'].includes(channel?.status),
  );
}

function statusVariant(channel) {
  if (isChannelConnected(channel)) return 'success';
  if (channel?.status === 'error' || channel?.status === 'failed') return 'danger';
  return 'neutral';
}

function errorMessage(error) {
  if (!error) return 'WhatsApp Embedded Signup could not be completed.';
  if (typeof error === 'string') return error;
  return error.message ?? error.error ?? 'WhatsApp Embedded Signup could not be completed.';
}

export default function ChannelsPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const metaPublicConfig = useMemo(() => getMetaPublicConfig(), []);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const signupCleanupRef = useRef(null);

  const canManage = MANAGER_ROLES.includes(activeMembership?.role);
  const canConnect = metaPublicConfig.isConfigured && canManage;
  const whatsappChannel = channels.find((channel) => channel.channel === 'whatsapp');
  const connectedCount = channels.filter(isChannelConnected).length;

  const loadChannels = useCallback(async () => {
    if (!businessId) return;

    try {
      const result = await listChannels(businessId);
      setChannels(result.filter((channel) => channel.channel !== 'ai_assistant'));
      setError('');
    } catch (loadError) {
      setError(toCommunicationServiceError(loadError).message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void Promise.resolve().then(loadChannels);
  }, [loadChannels]);

  useEffect(
    () => () => {
      if (typeof signupCleanupRef.current === 'function') signupCleanupRef.current();
    },
    [],
  );

  const handleConnect = useCallback(() => {
    if (!businessId || !canConnect || connecting) return;

    setConnecting(true);
    setError('');
    setSuccess('');

    const dispose = launchWhatsAppEmbeddedSignup({
      appId: metaPublicConfig.appId,
      configId: metaPublicConfig.configId,
      version: metaPublicConfig.embeddedSignupVersion,
      graphApiVersion: metaPublicConfig.graphApiVersion,
      onComplete: async ({
        code,
        wabaId,
        phoneNumberId,
        businessPortfolioId,
      }) => {
        try {
          await connectWhatsApp({
            businessId,
            code,
            wabaId,
            phoneNumberId,
            businessPortfolioId,
          });
          setSuccess('WhatsApp was connected successfully.');
          await loadChannels();
        } catch (connectError) {
          setError(toCommunicationServiceError(connectError).message);
        } finally {
          setConnecting(false);
          signupCleanupRef.current = null;
        }
      },
      onCancel: () => {
        setSuccess('WhatsApp Embedded Signup was cancelled.');
        setConnecting(false);
        signupCleanupRef.current = null;
      },
      onError: (signupError) => {
        setError(errorMessage(signupError));
        setConnecting(false);
        signupCleanupRef.current = null;
      },
    });

    signupCleanupRef.current = dispose;
  }, [businessId, canConnect, connecting, loadChannels, metaPublicConfig]);

  const handleDisconnect = async () => {
    if (!businessId || !whatsappChannel) return;
    if (!window.confirm('Disconnect WhatsApp from this workspace?')) return;

    setDisconnecting(true);
    setError('');
    setSuccess('');

    try {
      await disconnectChannel({ businessId, channel: 'whatsapp' });
      setSuccess('WhatsApp was disconnected.');
      await loadChannels();
    } catch (disconnectError) {
      setError(toCommunicationServiceError(disconnectError).message);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="channels-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="channels-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Communication channels
            </h2>
            <Badge variant="brand">Connected channels are server-managed</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Connect WhatsApp through the official Meta signup flow, then manage real
            customer conversations from the shared inbox.
          </p>
        </div>
        <Link
          to="/inbox"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50"
        >
          <Inbox className="h-4 w-4" aria-hidden="true" />
          Open inbox
        </Link>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      {!metaPublicConfig.isConfigured ? (
        <Alert
          variant="warning"
          title="WhatsApp Embedded Signup is not configured"
        >
          Add VITE_META_APP_ID and VITE_META_CONFIG_ID to your deployment environment,
          then reload this page. No channel can be connected until both public values
          are present.
        </Alert>
      ) : null}

      {metaPublicConfig.isConfigured && !canManage ? (
        <Alert variant="info">
          Only workspace owners, admins and managers can connect or disconnect channels.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500" aria-live="polite">
          {loading
            ? 'Loading channels...'
            : `${connectedCount} connected channel${connectedCount === 1 ? '' : 's'} in this workspace`}
        </p>
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2
              className="h-4 w-4 animate-spin text-slate-400"
              aria-label="Loading channels"
            />
          ) : null}
          {canConnect ? (
            <Button onClick={handleConnect} disabled={connecting || !businessId}>
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
              )}
              {connecting ? 'Connecting...' : 'Connect WhatsApp'}
            </Button>
          ) : null}
        </div>
      </div>

      {!loading && channels.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No channels yet"
          description={
            canConnect
              ? 'Connect WhatsApp to start receiving customer messages in the shared inbox.'
              : 'There are no communication channels registered for this workspace.'
          }
          action={
            canConnect ? (
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Connect WhatsApp
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {channels.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {channels.map((channel) => {
            const connected = isChannelConnected(channel);
            const isWhatsapp = channel.channel === 'whatsapp';

            return (
              <Card key={channel.id ?? channel.channel}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <MessageCircle className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="capitalize">
                        {isWhatsapp ? 'WhatsApp' : channel.channel}
                      </CardTitle>
                      <CardDescription>
                        {connected
                          ? 'Connected and receiving messages'
                          : 'Not connected'}
                      </CardDescription>
                    </div>
                    <Badge variant={statusVariant(channel)}>{channel.status ?? 'unknown'}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isWhatsapp && connected ? (
                    <dl className="space-y-2 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <dt className="text-slate-500">Phone number</dt>
                        <dd className="font-medium text-slate-800">
                          {channel.displayPhoneNumber ?? '—'}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <dt className="text-slate-500">Verified name</dt>
                        <dd className="font-medium text-slate-800">
                          {channel.verifiedName ?? '—'}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <dt className="text-slate-500">Phone number ID</dt>
                        <dd className="font-mono text-xs text-slate-700">
                          {channel.phoneNumberId ?? '—'}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <dt className="text-slate-500">WABA ID</dt>
                        <dd className="font-mono text-xs text-slate-700">
                          {channel.wabaId ?? '—'}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <dt className="text-slate-500">Portfolio ID</dt>
                        <dd className="font-mono text-xs text-slate-700">
                          {channel.businessPortfolioId ?? channel.accountId ?? '—'}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <dt className="text-slate-500">Connected</dt>
                        <dd className="text-slate-700">
                          {formatDateTime(channel.connectedAt)}
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  {!isWhatsapp || !connected ? (
                    <p className="text-sm text-slate-500">
                      {channel.lastError ??
                        'Connection details are maintained by the server.'}
                    </p>
                  ) : null}

                  {channel.lastError && connected ? (
                    <Alert variant="error" title="Last connection error">
                      {channel.lastError}
                    </Alert>
                  ) : null}

                  {isWhatsapp && connected && canManage ? (
                    <Button
                      variant="secondary"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                    >
                      {disconnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  ) : null}

                  <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
                    Added {formatDate(channel.createdAt)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
