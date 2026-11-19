import {
  Activity,
  BarChart3,
  Building2,
  CreditCard,
  Database,
  LayoutDashboard,
  MessageCircleMore,
  PlugZap,
  ReceiptText,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  UsersRound,
} from 'lucide-react';

export const platformNavigationItems = Object.freeze([
  {
    label: 'Overview',
    to: '/platform/overview',
    icon: LayoutDashboard,
    available: true,
  },
  {
    label: 'Businesses',
    to: '/platform/businesses',
    icon: Building2,
    available: true,
  },
  {
    label: 'Users & Staff',
    to: '/platform/users',
    icon: UsersRound,
    available: false,
  },
  {
    label: 'Storefronts',
    to: '/platform/storefronts',
    icon: Store,
    available: false,
  },
  {
    label: 'Orders & Payments',
    to: '/platform/orders-payments',
    icon: ReceiptText,
    available: false,
  },
  {
    label: 'AI Management',
    to: '/platform/ai',
    icon: Sparkles,
    available: false,
  },
  {
    label: 'Communications',
    to: '/platform/communications',
    icon: MessageCircleMore,
    available: false,
  },
  {
    label: 'Subscriptions',
    to: '/platform/subscriptions',
    icon: CreditCard,
    available: false,
  },
  {
    label: 'Integrations',
    to: '/platform/integrations',
    icon: PlugZap,
    available: false,
  },
  {
    label: 'Storage & Usage',
    to: '/platform/storage',
    icon: Database,
    available: false,
  },
  {
    label: 'System Health',
    to: '/platform/health',
    icon: Activity,
    available: false,
  },
  {
    label: 'Support & Audit',
    to: '/platform/audit',
    icon: ScrollText,
    available: false,
  },
  {
    label: 'Platform Settings',
    to: '/platform/settings',
    icon: Settings2,
    available: false,
  },
]);

export const platformNavIcons = Object.freeze({
  overview: BarChart3,
  security: ShieldCheck,
});
