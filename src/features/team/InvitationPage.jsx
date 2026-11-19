import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import {
  acceptInvitation,
  getInvitation,
  toTeamServiceError,
} from '../../services/teamService';
import { formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';

function getStatusVariant(status) {
  if (status === 'accepted') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'expired' || status === 'cancelled') return 'danger';
  return 'neutral';
}

function formatRole(role) {
  const value = String(role ?? '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Member';
}

export default function InvitationPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { status, user, refreshMemberships, signOut } = useAuth();
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [error, setError] = useState('');
  const [acceptedInvitation, setAcceptedInvitation] = useState(null);

  useEffect(() => {
    if (!token || status !== 'authenticated') return undefined;

    let active = true;

    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setError('');
        return getInvitation(token);
      })
      .then((details) => {
        if (!active) return;
        if (!details) throw new Error('This invitation link is invalid.');
        setInvitation(details);
      })
      .catch((loadError) => {
        if (active) setError(toTeamServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [status, token]);

  const emailMatches = useMemo(() => {
    const invitationEmail = String(invitation?.email ?? '').trim().toLowerCase();
    const userEmail = String(user?.email ?? '').trim().toLowerCase();
    return Boolean(invitationEmail && invitationEmail === userEmail);
  }, [invitation?.email, user?.email]);

  const canAccept = Boolean(
    invitation &&
      invitation.status === 'pending' &&
      emailMatches &&
      !accepting,
  );

  const handleAccept = useCallback(async () => {
    if (!token || !canAccept) return;

    setAccepting(true);
    setError('');

    try {
      const accepted = await acceptInvitation(token);
      if (!accepted?.businessId) throw new Error('The invitation could not be accepted.');

      await refreshMemberships({ activateBusinessId: accepted.businessId });
      setAcceptedInvitation(accepted);
      navigate('/overview', {
        replace: true,
        state: { notice: `You joined ${accepted.businessName ?? 'the workspace'}.` },
      });
    } catch (acceptError) {
      setError(toTeamServiceError(acceptError).message);
    } finally {
      setAccepting(false);
    }
  }, [canAccept, navigate, refreshMemberships, token]);

  const handleSwitchAccount = useCallback(async () => {
    setSwitchingAccount(true);
    setError('');

    try {
      await signOut();
      navigate('/login', {
        replace: true,
        state: { from: `/invite/${token}` },
      });
    } catch (switchError) {
      setError(switchError.message);
    } finally {
      setSwitchingAccount(false);
    }
  }, [navigate, signOut, token]);

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6" aria-labelledby="invitation-title">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2
          id="invitation-title"
          className="mt-4 text-xl font-semibold tracking-tight text-slate-900"
        >
          Workspace invitation
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Review the invitation details before joining the workspace.
        </p>
      </div>

      {!token ? (
        <Alert variant="error" title="This invitation link is invalid">
          Open the complete invitation link sent by the workspace owner or admin.
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="error" title="This invitation could not be opened">
          {error}
        </Alert>
      ) : null}

      {acceptedInvitation ? (
        <Alert variant="success" title="Invitation accepted">
          You joined {acceptedInvitation.businessName ?? 'the workspace'}. Opening your
          dashboard…
        </Alert>
      ) : null}

      {!token ? null : loading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking invitation…
          </CardContent>
        </Card>
      ) : invitation ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{invitation.businessName ?? 'Workspace'}</CardTitle>
                  <CardDescription>
                    You have been invited to join this OrderFlow AI workspace.
                  </CardDescription>
                </div>
                <Badge variant={getStatusVariant(invitation.status)}>
                  {invitation.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Invited email
                  </p>
                  <p className="mt-1 break-all text-sm font-medium text-slate-800">
                    {invitation.email}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Workspace role
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {formatRole(invitation.role)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Signed in as {user?.email ?? 'your account'}
                </span>
                {invitation.expiresAt ? (
                  <span>Expires {formatDateTime(invitation.expiresAt)}</span>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {!emailMatches ? (
            <Alert variant="warning" title="Use the invited email address">
              <p>
                This invitation was sent to {invitation.email}. Sign in with that email to
                accept it.
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={switchingAccount}
                onClick={handleSwitchAccount}
                className="mt-3"
              >
                {switchingAccount ? 'Signing out…' : 'Use another account'}
              </Button>
            </Alert>
          ) : null}

          {invitation.status === 'accepted' ? (
            <Alert variant="success" title="Already accepted">
              This invitation has already been accepted.{' '}
              <Link to="/overview" className="font-medium underline underline-offset-2">
                Go to dashboard
              </Link>
            </Alert>
          ) : null}

          {invitation.status === 'cancelled' ? (
            <Alert variant="error" title="Invitation cancelled">
              The workspace owner cancelled this invitation.
            </Alert>
          ) : null}

          {invitation.status === 'expired' ? (
            <Alert variant="error" title="Invitation expired">
              Ask a workspace owner or admin to send a new invitation.
            </Alert>
          ) : null}

          {canAccept ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" disabled={accepting} onClick={handleAccept}>
                {accepting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                {accepting ? 'Joining…' : `Join ${invitation.businessName ?? 'workspace'}`}
              </Button>
              <Link
                to="/workspaces"
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Back to workspaces
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
