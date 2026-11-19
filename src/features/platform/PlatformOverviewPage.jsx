import { useEffect, useState } from 'react';
import {
  Activity,
  Building2,
  Database,
  ShoppingCart,
  Sparkles,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageLoader } from '../../components/ui/PageLoader';
import { StatCard } from '../dashboard/components/StatCard';
import { toAuthServiceError } from '../../services/authService';
import { fetchPlatformOverview } from './platformService';

const numberFormatter = new Intl.NumberFormat();

function formatCount(value) {
  return numberFormatter.format(Number(value ?? 0));
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function PlatformOverviewPage() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await fetchPlatformOverview();
        if (active) setState({ status: 'ready', data, error: null });
      } catch (error) {
        if (active) {
          setState({
            status: 'error',
            data: null,
            error: toAuthServiceError(error).message,
          });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'loading') return <PageLoader />;

  if (state.status === 'error') {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle as="h1">Platform overview unavailable</CardTitle>
            <CardDescription>{state.error}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const data = state.data ?? {};

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Platform overview
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Live platform totals from OrderFlow AI records. No illustrative figures are
          shown.
        </p>
      </section>

      <section aria-labelledby="platform-metrics-heading">
        <h2 id="platform-metrics-heading" className="sr-only">
          Platform metrics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Building2}
            label="Total businesses"
            value={formatCount(data.total_businesses)}
            hint="All registered businesses"
            tone="brand"
          />
          <StatCard
            icon={Building2}
            label="Active businesses"
            value={formatCount(data.active_businesses)}
            hint="Businesses with an active storefront"
            tone="emerald"
          />
          <StatCard
            icon={Users}
            label="Total users"
            value={formatCount(data.total_users)}
            hint="Registered platform profiles"
            tone="slate"
          />
          <StatCard
            icon={ShoppingCart}
            label="Orders"
            value={formatCount(data.total_orders)}
            hint="Orders across all businesses"
            tone="brand"
          />
          <StatCard
            icon={Activity}
            label="Pending approvals"
            value={formatCount(data.pending_orders)}
            hint="Awaiting business approval"
            tone="amber"
          />
          <StatCard
            icon={WalletCards}
            label="Verified payments"
            value={formatCount(data.verified_payments)}
            hint="Verified payment records"
            tone="emerald"
          />
          <StatCard
            icon={Sparkles}
            label="AI requests"
            value={formatCount(data.ai_requests)}
            hint={`Estimated provider spend: $${Number(data.ai_estimated_cost_usd ?? 0).toFixed(2)}`}
            tone="brand"
          />
          <StatCard
            icon={Database}
            label="Storage used"
            value={formatBytes(data.storage_bytes)}
            hint="Active media assets"
            tone="slate"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Platform revenue</CardTitle>
              <CardDescription>OrderFlow AI earnings only</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight text-slate-900">
              {data.platform_revenue_amount == null
                ? 'Not configured'
                : `RWF ${formatCount(data.platform_revenue_amount)}`}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {data.platform_revenue_note}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Operational activity</CardTitle>
              <CardDescription>Detailed feeds are added in later phases</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Activity}
              title="No activity feed connected yet"
              description="Registration, order, subscription and AI usage timelines will appear here once their read models are added."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
