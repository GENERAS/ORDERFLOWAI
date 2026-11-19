import { useEffect, useState } from 'react';
import { Database, Files, HardDrive } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageLoader } from '../../components/ui/PageLoader';
import { StatCard } from '../dashboard/components/StatCard';
import { formatBytes, formatCount } from './platformFormatters';
import { fetchPlatformStorageUsage } from './platformService';
import { PageIntro, SectionCard } from './platformUi';

function BreakdownRows({ breakdown }) {
  const entries = Object.entries(breakdown ?? {});
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No assets recorded.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {entries.map(([key, value]) => (
        <li
          key={key}
          className="flex items-center justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0"
        >
          <span className="font-medium text-slate-700">{key}</span>
          <span className="text-xs text-slate-500">
            {formatCount(value?.assets)} assets · {formatBytes(value?.bytes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function PlatformStoragePage() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let active = true;

    fetchPlatformStorageUsage()
      .then((data) => {
        if (active) setState({ status: 'ready', data, error: null });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            data: null,
            error: error.message ?? 'Unable to load storage usage.',
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
        <PageIntro
          title="Storage & usage"
          description="Aggregate media storage recorded by the platform."
        />
        <Alert variant="error" title="Storage usage unavailable">
          {state.error}
        </Alert>
      </div>
    );
  }

  const data = state.data ?? {};
  const hasAssets = Number(data.asset_count ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageIntro
        title="Storage & usage"
        description="Aggregate media asset totals from platform records. Failed uploads are counted separately from usable assets."
        badge="Live totals"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={HardDrive}
          label="Bytes in use"
          value={formatBytes(data.total_bytes)}
          hint="All non-deleted media assets"
          tone="brand"
        />
        <StatCard
          icon={Files}
          label="Assets"
          value={formatCount(data.asset_count)}
          hint="Non-deleted asset records"
          tone="slate"
        />
        <StatCard
          icon={Database}
          label="Businesses with assets"
          value={formatCount(data.business_count)}
          hint="Distinct businesses storing media"
          tone="emerald"
        />
        <StatCard
          icon={Files}
          label="Failed assets"
          value={formatCount(data.failed_count)}
          hint="Uploads recorded as failed"
          tone="amber"
        />
      </div>

      {!hasAssets ? (
        <EmptyState
          icon={Database}
          title="No media assets recorded"
          description="Storage totals are zero because no business has uploaded media yet."
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="By provider" description="Recorded storage provider split.">
          <BreakdownRows breakdown={data.by_provider} />
        </SectionCard>
        <SectionCard title="By asset category" description="Recorded asset category split.">
          <BreakdownRows breakdown={data.by_category} />
        </SectionCard>
      </div>
    </div>
  );
}
