import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock3,
  MessageSquare,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { PageLoader } from '../../components/ui/PageLoader';
import { StatCard } from '../dashboard/components/StatCard';
import { formatCount, formatDate } from './platformFormatters';
import { fetchPlatformHealth } from './platformService';
import { PageIntro } from './platformUi';

export default function PlatformHealthPage() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let active = true;

    fetchPlatformHealth()
      .then((data) => {
        if (active) setState({ status: 'ready', data, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            data: null,
            error: error.message ?? 'Unable to load system health.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'loading') return <PageLoader />;

  if (state.status === 'error') {
    return (
      <div className="space-y-6">
        <PageIntro title="System health" description="Signals derived from recorded platform data." />
        <Alert variant="error" title="Health signals unavailable">
          {state.error}
        </Alert>
      </div>
    );
  }

  const data = state.data ?? {};
  const staleSupport = Number(data.expired_support_sessions ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageIntro
        title="System health"
        description="Recorded operational signals only. Uptime percentages and synthetic availability scores are not reported."
        badge="Recorded signals"
      />

      {staleSupport ? (
        <Alert variant="warning" title="Expired support sessions still open">
          {formatCount(data.expired_support_sessions)} sessions have passed expiry without
          being explicitly ended. They no longer grant workspace access.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Clock3}
          label="Active support sessions"
          value={formatCount(data.active_support_sessions)}
          hint="Unexpired, unended sessions"
          tone="brand"
        />
        <StatCard
          icon={ShoppingCart}
          label="Pending orders"
          value={formatCount(data.pending_orders)}
          hint="Awaiting business approval"
          tone="amber"
        />
        <StatCard
          icon={Activity}
          label="Pending payments"
          value={formatCount(data.pending_payments)}
          hint="Awaiting verification"
          tone="amber"
        />
        <StatCard
          icon={MessageSquare}
          label="Connected channels"
          value={formatCount(data.connected_channels)}
          hint="Business channel connections in connected state"
          tone="emerald"
        />
        <StatCard
          icon={Sparkles}
          label="Failed AI requests (24h)"
          value={formatCount(data.failed_ai_requests_24h)}
          hint="Recorded failed or rate-limited requests"
          tone="slate"
        />
        <StatCard
          icon={AlertTriangle}
          label="Failed webhooks (24h)"
          value={formatCount(data.failed_webhook_events_24h)}
          hint="Recorded failed webhook events"
          tone="slate"
        />
        <StatCard
          icon={Activity}
          label="Failed media assets"
          value={formatCount(data.failed_media_assets)}
          hint="Uploads recorded as failed"
          tone="slate"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          Latest recorded activity
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Last AI request</dt>
            <dd className="mt-1 text-sm text-slate-800">
              {formatDate(data.last_ai_request_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Last webhook event</dt>
            <dd className="mt-1 text-sm text-slate-800">
              {formatDate(data.last_webhook_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Signals checked at</dt>
            <dd className="mt-1 text-sm text-slate-800">{formatDate(data.checked_at)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
