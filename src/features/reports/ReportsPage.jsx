import { BarChart3 } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function ReportsPage() {
  return (
    <ModulePlaceholder
      icon={BarChart3}
      title="Reports and analytics"
      description="Understand sales, outstanding payments, product performance and team activity from real business records."
      emptyTitle="No reports yet"
      emptyDescription="Reports populate only from real records. No sample or fabricated metrics are shown."
      upcoming={[
        'Sales and order totals',
        'Outstanding payments',
        'Best-selling and low-stock products',
        'Customer and repeat-customer activity',
        'Order processing time',
        'Channel performance',
      ]}
    />
  );
}
