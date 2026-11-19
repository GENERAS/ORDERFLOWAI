import {
  ArrowRight,
  Boxes,
  CreditCard,
  Inbox,
  Package,
  ShoppingCart,
  Sparkles,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from './components/StatCard';

const stats = [
  { label: 'Total orders', icon: ShoppingCart, tone: 'brand' },
  { label: 'Products', icon: Package, tone: 'emerald' },
  { label: 'Customers', icon: Users, tone: 'slate' },
  { label: 'Outstanding payments', icon: CreditCard, tone: 'amber' },
];

const nextSteps = [
  { to: '/assistant', label: 'Test the read-only AI assistant', icon: Sparkles },
  { to: '/products', label: 'Add products and photos', icon: Package },
  { to: '/inventory', label: 'Configure stock', icon: Boxes },
  { to: '/inbox', label: 'Capture customer inquiries', icon: Inbox },
  { to: '/settings', label: 'Set currency and business profile', icon: CreditCard },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative px-6 py-7 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <Badge variant="brand">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Foundation ready
              </Badge>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                Welcome to OrderFlow AI
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Turn customer conversations into organised orders using your real product
                catalogue. Your workspace is ready for products, orders, payments and
                AI-assisted workflows.
              </p>
            </div>
            <Link
              to="/products"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Set up your catalogue
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">
          Business metrics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Metrics populate only from real business records once data features are connected. No
          sample figures are shown.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle as="h2">Recent activity</CardTitle>
              <CardDescription>
                Orders, payments and catalogue changes will appear here.
              </CardDescription>
            </div>
            <Badge variant="neutral">Empty</Badge>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Inbox}
              title="No activity yet"
              description="Once your team starts adding products and processing orders, a chronological activity trail will show up here."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Next steps</CardTitle>
              <CardDescription>Build the core workflow in order.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {nextSteps.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50/50 hover:text-brand-700"
              >
                <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="flex-1">{label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
