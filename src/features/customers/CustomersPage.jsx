import { Users } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function CustomersPage() {
  return (
    <ModulePlaceholder
      icon={Users}
      title="Customers"
      description="Keep customer profiles, contact details, addresses and purchase history in one organised record."
      emptyTitle="No customers yet"
      emptyDescription="Customers are created manually at first and can later be linked to conversations and orders."
      upcoming={[
        'Customer profiles and contact details',
        'Customer addresses',
        'Order and payment history',
        'Duplicate customer detection',
        'Notes and preferences',
        'Communication history',
      ]}
    />
  );
}
