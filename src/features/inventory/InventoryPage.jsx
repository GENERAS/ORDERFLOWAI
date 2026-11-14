import { Boxes } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function InventoryPage() {
  return (
    <ModulePlaceholder
      icon={Boxes}
      title="Inventory"
      description="Track physical, reserved and available stock with a complete movement history."
      emptyTitle="No inventory records yet"
      emptyDescription="Stock balances and movements will appear once products are added and orders begin reserving stock."
      upcoming={[
        'Physical, reserved and available stock',
        'Stock movement history',
        'Low-stock indicators',
        'Reservation rules on order confirmation',
        'Overselling prevention',
        'Manual stock adjustments',
      ]}
    />
  );
}
