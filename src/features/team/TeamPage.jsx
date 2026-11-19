import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Mail, Trash2, UserPlus, UsersRound } from 'lucide-react';
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
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import {
  cancelInvitation,
  getInvitationLink,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  setMemberStatus,
  toTeamServiceError,
  updateMemberRole,
} from '../../services/teamService';
import { formatDate, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';

const MANAGE_ROLES = ['owner', 'admin'];
const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
];

function getInitials(fullName) {
  const initials = String(fullName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || 'TM';
}

function getRoleVariant(role) {
  if (role === 'owner') return 'brand';
  if (role === 'admin') return 'warning';
  if (role === 'manager') return 'success';
  return 'neutral';
}

function getStatusVariant(status) {
  if (status === 'active') return 'success';
  if (status === 'suspended' || status === 'pending') return 'warning';
  return 'neutral';
}

export default function TeamPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const canManage = MANAGE_ROLES.includes(activeMembership?.role);
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviting, setInviting] = useState(false);
  const [newInviteLink, setNewInviteLink] = useState('');
  const [copyState, setCopyState] = useState('');
  const [roleDrafts, setRoleDrafts] = useState({});
  const [pendingAction, setPendingAction] = useState('');

  const loadTeam = useCallback(async () => {
    if (!businessId || !canManage) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [memberRows, invitationRows] = await Promise.all([
        listMembers(businessId),
        listInvitations(businessId),
      ]);
      setMembers(memberRows);
      setInvitations(invitationRows);
      setError('');
    } catch (loadError) {
      setError(toTeamServiceError(loadError).message);
    } finally {
      setLoading(false);
    }
  }, [businessId, canManage]);

  useEffect(() => {
    void Promise.resolve().then(loadTeam);
  }, [loadTeam]);

  const copyLink = useCallback(async (link) => {
    if (!link || !navigator.clipboard?.writeText) {
      setCopyState('manual');
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  }, []);

  const runAction = async (key, action, message) => {
    setPendingAction(key);
    setError('');
    setSuccess('');

    try {
      await action();
      setSuccess(message);
      await loadTeam();
    } catch (actionError) {
      setError(toTeamServiceError(actionError).message);
    } finally {
      setPendingAction(null);
    }
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    const roleValid = ROLE_OPTIONS.some((option) => option.value === inviteRole);
    if (!businessId || !canManage || !email || !roleValid || inviting) return;

    setInviting(true);
    setError('');
    setSuccess('');
    setNewInviteLink('');
    setCopyState('');

    try {
      const invitation = await inviteMember({ businessId, email, role: inviteRole });
      const link = getInvitationLink(invitation?.token);
      setNewInviteLink(link);
      setInviteEmail('');
      setRoleDrafts({});
      setSuccess(
        `Invitation created for ${invitation?.email ?? email}. Share the link below; no email was sent.`,
      );
      if (link) await copyLink(link);
      await loadTeam();
    } catch (inviteError) {
      setError(toTeamServiceError(inviteError).message);
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvitation = (invitation) => {
    if (!window.confirm(`Cancel the invitation for ${invitation.email}?`)) return;
    return runAction(
      `cancel:${invitation.id}`,
      () => cancelInvitation(invitation.id),
      `Invitation for ${invitation.email} was cancelled.`,
    );
  };

  const handleRoleSave = (member) => {
    const role = roleDrafts[member.userId] ?? member.role;
    if (role === member.role || !ROLE_OPTIONS.some((option) => option.value === role)) {
      return;
    }
    return runAction(
      `role:${member.userId}`,
      () => updateMemberRole({ businessId, userId: member.userId, role }),
      `The role for ${member.fullName} was updated.`,
    );
  };

  const handleSetStatus = (member) => {
    const nextStatus = member.status === 'active' ? 'suspended' : 'active';
    const verb = nextStatus === 'suspended' ? 'Suspend' : 'Activate';
    if (!window.confirm(`${verb} ${member.fullName} in this workspace?`)) return;
    return runAction(
      `status:${member.userId}`,
      () => setMemberStatus({ businessId, userId: member.userId, status: nextStatus }),
      `${member.fullName} is now ${nextStatus}.`,
    );
  };

  const handleRemoveMember = (member) => {
    if (!window.confirm(`Remove ${member.fullName} from this workspace?`)) return;
    return runAction(
      `remove:${member.userId}`,
      () => removeMember({ businessId, userId: member.userId }),
      `${member.fullName} was removed from the workspace.`,
    );
  };

  return (
    <section className="space-y-6" aria-labelledby="team-title">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="team-title"
            className="text-lg font-semibold tracking-tight text-slate-900"
          >
            Team and permissions
          </h2>
          <Badge variant="brand">Server-enforced roles</Badge>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
          Invite people to {activeBusiness?.name ?? 'this workspace'} and control their
          access with roles that are enforced by the server.
        </p>
      </div>

      {error ? (
        <Alert variant="error" title="The team request could not be completed">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              className="text-xs font-medium text-red-700 underline-offset-2 hover:underline"
              onClick={() => setError('')}
            >
              Dismiss
            </button>
          </div>
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="success">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span>{success}</span>
            <button
              type="button"
              className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
              onClick={() => setSuccess('')}
            >
              Dismiss
            </button>
          </div>
        </Alert>
      ) : null}

      {!canManage ? (
        <Alert variant="info" title="Workspace owner or admin access required">
          Only owners and admins can view members, invitations and access changes in this
          workspace.
        </Alert>
      ) : (
        <>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading team...
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <UserPlus className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <CardTitle>Invite a member</CardTitle>
                  <CardDescription>
                    Create a link that expires after 7 days. Share it directly; no email is
                    sent by OrderFlow AI.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleInvite}
                className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
              >
                <FormField
                  id="invite-email"
                  label="Email address"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@company.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <SelectField
                  id="invite-role"
                  label="Role"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                  options={ROLE_OPTIONS}
                />
                <Button
                  type="submit"
                  disabled={
                    inviting ||
                    !inviteEmail.trim() ||
                    !ROLE_OPTIONS.some((option) => option.value === inviteRole)
                  }
                >
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {inviting ? 'Creating...' : 'Create invitation'}
                </Button>
              </form>
              <p className="mt-3 text-xs text-slate-400">
                The link is shown once when the invitation is created and cannot be
                retrieved later.
              </p>
            </CardContent>
          </Card>

          {newInviteLink ? (
            <Alert variant="info" title="Invitation link ready">
              <p className="break-all font-mono text-xs">{newInviteLink}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => copyLink(newInviteLink)}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy link
                </Button>
                {copyState === 'copied' ? (
                  <span className="text-xs text-slate-600">Copied to clipboard.</span>
                ) : null}
                {copyState === 'manual' ? (
                  <span className="text-xs text-slate-600">
                    Select the link above and copy it manually.
                  </span>
                ) : null}
              </div>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <UsersRound className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <CardTitle>Members</CardTitle>
                  <CardDescription>
                    Change roles, suspend access or remove people from this workspace.
                  </CardDescription>
                </div>
              </div>
              <Badge variant="neutral">
                {members.length} member{members.length === 1 ? '' : 's'}
              </Badge>
            </CardHeader>
            <CardContent>
              {!loading && members.length === 0 ? (
                <EmptyState
                  icon={UsersRound}
                  title="No members yet"
                  description="Members appear here once an invitation is accepted."
                />
              ) : null}
              {!loading && members.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {members.map((member) => {
                    const roleBusy = pendingAction === `role:${member.userId}`;
                    const statusBusy = pendingAction === `status:${member.userId}`;
                    const removeBusy = pendingAction === `remove:${member.userId}`;
                    const busy = roleBusy || statusBusy || removeBusy;
                    const roleDraft = roleDrafts[member.userId] ?? member.role;
                    const roleChanged =
                      roleDraft !== member.role &&
                      ROLE_OPTIONS.some((option) => option.value === roleDraft);

                    return (
                      <li
                        key={member.userId}
                        className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                            {getInitials(member.fullName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {member.fullName}
                            </p>
                            {member.email ? (
                              <p className="truncate text-xs text-slate-500">
                                {member.email}
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge variant={getRoleVariant(member.role)}>
                                {member.role}
                              </Badge>
                              <Badge variant={getStatusVariant(member.status)}>
                                {member.status}
                              </Badge>
                              {member.isLastActiveOwner ? (
                                <Badge variant="warning">Last active owner</Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <SelectField
                            aria-label={`Role for ${member.fullName}`}
                            value={roleDraft}
                            onChange={(event) =>
                              setRoleDrafts((current) => ({
                                ...current,
                                [member.userId]: event.target.value,
                              }))
                            }
                            options={ROLE_OPTIONS}
                            className="w-32"
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!roleChanged || busy}
                            onClick={() => handleRoleSave(member)}
                          >
                            {roleBusy ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : null}
                            Save role
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={member.isLastActiveOwner || busy}
                            onClick={() => handleSetStatus(member)}
                          >
                            {statusBusy ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : null}
                            {member.status === 'active' ? 'Suspend' : 'Activate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={member.isLastActiveOwner || busy}
                            onClick={() => handleRemoveMember(member)}
                          >
                            {removeBusy ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Remove
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {members.some((member) => member.isLastActiveOwner) ? (
                <p className="mt-4 text-xs text-slate-400">
                  The last active owner cannot be demoted, suspended or removed.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Mail className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <CardTitle>Pending invitations</CardTitle>
                  <CardDescription>
                    Invitation links are shown only at creation and cannot be copied again.
                  </CardDescription>
                </div>
              </div>
              <Badge variant="neutral">{invitations.length} pending</Badge>
            </CardHeader>
            <CardContent>
              {!loading && invitations.length === 0 ? (
                <EmptyState
                  icon={Mail}
                  title="No pending invitations"
                  description="Create an invitation above to add someone to this workspace."
                />
              ) : null}
              {!loading && invitations.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {invitations.map((invitation) => {
                    const cancelling = pendingAction === `cancel:${invitation.id}`;
                    return (
                      <li
                        key={invitation.id}
                        className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {invitation.email}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Invited {formatDate(invitation.createdAt)} · Expires{' '}
                            {formatDateTime(invitation.expiresAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getRoleVariant(invitation.role)}>
                            {invitation.role}
                          </Badge>
                          <Badge variant={getStatusVariant(invitation.status)}>
                            {invitation.status}
                          </Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={cancelling || invitation.status !== 'pending'}
                            onClick={() => handleCancelInvitation(invitation)}
                          >
                            {cancelling ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : null}
                            Cancel
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
