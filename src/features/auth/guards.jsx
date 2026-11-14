import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageLoader } from '../../components/ui/PageLoader';
import { useAuth } from './authContext';
import { getPostAuthPath } from './authRouting';
import { AuthErrorScreen } from './components/AuthErrorScreen';

export function RequireAuth() {
  const { status, error, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageLoader />;
  if (status === 'error') {
    return <AuthErrorScreen message={error} onRetry={retry} />;
  }
  if (status !== 'authenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}

export function RequireWorkspace() {
  const { status, error, retry, memberships, activeBusinessId } = useAuth();

  if (status === 'loading') return <PageLoader />;
  if (status === 'error') {
    return <AuthErrorScreen message={error} onRetry={retry} />;
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  if (memberships.length === 0) return <Navigate to="/onboarding" replace />;
  if (!activeBusinessId) return <Navigate to="/workspaces" replace />;

  return <Outlet />;
}

export function RootRedirect() {
  const { status, error, retry, memberships, activeBusinessId } = useAuth();

  if (status === 'loading') return <PageLoader />;
  if (status === 'error') {
    return <AuthErrorScreen message={error} onRetry={retry} />;
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;

  return (
    <Navigate
      to={getPostAuthPath({ memberships, activeBusinessId })}
      replace
    />
  );
}
