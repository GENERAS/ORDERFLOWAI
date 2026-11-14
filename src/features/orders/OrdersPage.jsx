import { ShoppingCart } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function OrdersPage() {
  return (
    <ModulePlaceholder
      icon={ShoppingCart}
      title="Order management"
      description="Create, review and track orders from draft through confirmation, fulfilment and completion."
      emptyTitle="No orders yet"
      emptyDescription="AI-assisted order drafts and human-approved orders will be tracked here once order management is implemented."
      upcoming={[
        'Draft, customer-confirmed and approved states',
        'Order items and agreed prices',
        'Status history and activity trail',
        'Duplicate order detection',
        'Cancellation and stock-release rules',
        'Stock reservation on confirmation',
      ]}
    />
  );
}
