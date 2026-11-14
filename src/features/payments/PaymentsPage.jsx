import { CreditCard } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function PaymentsPage() {
  return (
    <ModulePlaceholder
      icon={CreditCard}
      title="Payment records"
      description="Record and verify payments separately from order status, including partial payments and refunds."
      emptyTitle="No payments recorded yet"
      emptyDescription="Payment records and manual verification arrive after order management is in place."
      upcoming={[
        'Unpaid, partially paid and paid states',
        'Partial payments and outstanding balances',
        'Manual verification evidence',
        'Refund records',
        'Payment method and reference fields',
        'Future mobile money integrations',
      ]}
    />
  );
}
