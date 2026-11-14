import { useEffect } from 'react';
import { ArrowRight, Building2, Check, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { SetupShell } from '../../components/layout/SetupShell';
import { useAuth } from '../auth/authContext';

const roleLabels = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
};

const roleVariants = {
  owner: 'brand',
  admin: 'success',
  manager: 'warning',
  staff: 'neutral',
};

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const { memberships, activeBusinessId, selectBusiness } = useAuth();

  useEffect(() => {
    if (memberships.length === 0) {
      navigate('/onboarding', { replace: true });
      return;
    }

    if (memberships.length === 1) {
      selectBusiness(memberships[0].business.id);
      navigate('/overview', { replace: true });
    }
  }, [memberships, selectBusiness, navigate]);

  const openWorkspace = (businessId) => {
    selectBusiness(businessId);
    navigate('/overview', { replace: true });
  };

  if (memberships.length === 0) {
    return (
      <SetupShell>
        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h1">No workspace yet</CardTitle>
              <CardDescription>
                Create a business workspace to start using OrderFlow AI.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Link
              to="/onboarding"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Create a workspace
            </Link>
          </CardContent>
        </Card>
      </SetupShell>
    );
  }

  return (
    <SetupShell>
      <div className="mb-6">
        <Badge variant="brand">
          <Building2 className="h-3 w-3" aria-hidden="true" />
          Workspace access
        </Badge>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
          Choose a workspace
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
          Your account belongs to more than one business. Choose which workspace to open.
          You can switch again from the account menu.
        </p>
      </div>

      <div className="space-y-3">
        {memberships.map((membership) => {
          const isActive = membership.business.id === activeBusinessId;

          return (
            <Card
              key={membership.id}
              className={isActive ? 'border-brand-300 ring-2 ring-brand-100' : undefined}
            >
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-slate-900">
                      {membership.business.name}
                    </h2>
                    <Badge variant={roleVariants[membership.role] ?? 'neutral'}>
                      {roleLabels[membership.role] ?? membership.role}
                    </Badge>
                    {isActive ? (
                      <Badge variant="success">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Current
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {membership.business.slug} · {membership.business.country} ·{' '}
                    {membership.business.currency} · {membership.business.timezone}
                  </p>
                </div>

                <Button
                  variant={isActive ? 'secondary' : 'primary'}
                  onClick={() => openWorkspace(membership.business.id)}
                  className="shrink-0"
                >
                  {isActive ? 'Open workspace' : 'Switch to workspace'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <Link
          to="/onboarding"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-800"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create another workspace
        </Link>
      </div>
    </SetupShell>
  );
}
