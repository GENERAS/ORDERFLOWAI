import {
  BarChart3,
  Boxes,
  CreditCard,
  Inbox,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Users,
  UsersRound,
} from 'lucide-react';

export const navigationItems = Object.freeze([
  { label: 'Overview', to: '/overview', icon: LayoutDashboard },
  { label: 'Inbox', to: '/inbox', icon: Inbox },
  { label: 'Orders', to: '/orders', icon: ShoppingCart },
  { label: 'Products', to: '/products', icon: Package },
  { label: 'Inventory', to: '/inventory', icon: Boxes },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Payments', to: '/payments', icon: CreditCard },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
  { label: 'Team', to: '/team', icon: UsersRound },
  { label: 'Settings', to: '/settings', icon: Settings },
]);

export function findNavigationItem(pathname) {
  if (!pathname) return null;
  return (
    navigationItems.find(
      (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
    ) ?? null
  );
}
