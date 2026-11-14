import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { useAuth } from './authContext';
import { AuthCard } from './components/AuthCard';

function readCallbackError() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return (
    query.get('error_description') ||
    query.get('error') ||
    hash.get('error_description') ||
    hash.get('error') ||
    ''
  );
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { status, error, retry } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const callbackError = useMemo(() => readCallbackError(), []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimedOut(true), 8000);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  const showLinkError =
    Boolean(callbackError) ||
    status === 'error' ||
    (timedOut && status !== 'authenticated');

  if (showLinkError) {
    return (
      <AuthCard
        title="We could not confirm your link"
        description="The link may be invalid, expired or already used."
        footer={
          <p className="text-center">
            <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800">
              Back to sign in
            </Link>
          </p>
        }
      >
        <div className="space-y-4">
          <Alert variant="error">
            {callbackError || error || 'The confirmation link has expired. Request a new one.'}
          </Alert>

          {status === 'error' ? (
            <Button type="button" onClick={retry} className="w-full">
              Try again
            </Button>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              to="/verify-email"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              Resend confirmation
            </Link>
            <Link
              to="/forgot-password"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              Reset password
            </Link>
          </div>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={status === 'authenticated' ? 'Opening your workspace' : 'Confirming your link'}
      description={
        status === 'authenticated'
          ? 'Your account is verified. Taking you to your workspace.'
          : 'Hang on while we verify your email address.'
      }
    >
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-3 py-8 text-sm text-slate-500"
      >
        <span
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600"
          aria-hidden="true"
        />
        <span>Verifying your link…</span>
      </div>
    </AuthCard>
  );
}
