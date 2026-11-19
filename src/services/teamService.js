import { getSupabaseClient } from '../lib/supabase/client';

const ERROR_MESSAGES = Object.freeze({
  '42501': 'You do not have permission to manage this workspace team.',
  '28000': 'Sign in again to manage this workspace team.',
  PGRST116: 'The requested team record could not be found.',
});

export class TeamServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'TeamServiceError';
    this.code = code ?? null;
    this.details = details ?? null;
    this.hint = hint ?? null;
  }
}

function isPermissionError(error) {
  return /row-level security|permission denied|insufficient privilege/i.test(
    error?.message ?? '',
  );
}

export function toTeamServiceError(error) {
  if (error instanceof TeamServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (!message && isPermissionError(error)) message = ERROR_MESSAGES['42501'];
  if (!message && (code === '22023' || code === '23505')) {
    message = error?.message;
  }
  if (!message) {
    message = error?.message || 'The team request could not be completed.';
  }

  return new TeamServiceError(message, {
    cause: error,
    code,
    details: error?.details,
    hint: error?.hint,
  });
}

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toTeamServiceError(error);
  }
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

async function rpc(name, params) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw toTeamServiceError(error);
  return data;
}

export function getInvitationLink(token) {
  if (!token) return '';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/invite/${token}`;
}

export function mapMember(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    fullName: row.full_name ?? row.email ?? 'Team member',
    email: row.email ?? null,
    avatarUrl: row.avatar_url ?? null,
    role: row.role ?? 'staff',
    status: row.status ?? 'active',
    joinedAt: row.created_at ?? null,
    isLastActiveOwner: Boolean(row.is_last_active_owner),
  };
}

export function mapInvitation(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status ?? 'pending',
    invitedByName: row.invited_by_name ?? null,
    invitedByEmail: row.invited_by_email ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at ?? null,
    acceptedAt: row.accepted_at ?? null,
  };
}

export function mapInvitationDetails(row) {
  if (!row) return null;
  return {
    ...mapInvitation(row),
    token: row.token ?? null,
  };
}

export function mapInvitationPreview(row) {
  if (!row) return null;
  return {
    businessName: row.business_name ?? null,
    email: row.email ?? null,
    role: row.role ?? null,
    status: row.status ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

export function mapAcceptedInvitation(row) {
  if (!row) return null;
  return {
    businessId: row.business_id ?? null,
    businessName: row.business_name ?? null,
    email: row.email ?? null,
    role: row.role ?? null,
  };
}

export async function listMembers(businessId) {
  const data = await rpc('workspace_list_members', { p_business_id: businessId });
  return toArray(data).map(mapMember);
}

export async function listInvitations(businessId) {
  const data = await rpc('workspace_list_invitations', { p_business_id: businessId });
  return toArray(data).map(mapInvitation);
}

export async function inviteMember({ businessId, email, role }) {
  const data = await rpc('workspace_invite_member', {
    p_business_id: businessId,
    p_email: String(email ?? '').trim(),
    p_role: role,
  });
  return mapInvitationDetails(unwrapRpc(data));
}

export async function cancelInvitation(invitationId) {
  const data = await rpc('workspace_cancel_invitation', {
    p_invitation_id: invitationId,
  });
  return Boolean(unwrapRpc(data));
}

export async function updateMemberRole({ businessId, userId, role }) {
  const data = await rpc('workspace_update_member_role', {
    p_business_id: businessId,
    p_user_id: userId,
    p_role: role,
  });
  return Boolean(unwrapRpc(data));
}

export async function setMemberStatus({ businessId, userId, status }) {
  const data = await rpc('workspace_set_member_status', {
    p_business_id: businessId,
    p_user_id: userId,
    p_status: status,
  });
  return Boolean(unwrapRpc(data));
}

export async function removeMember({ businessId, userId }) {
  const data = await rpc('workspace_remove_member', {
    p_business_id: businessId,
    p_user_id: userId,
  });
  return Boolean(unwrapRpc(data));
}

export async function getInvitation(token) {
  const data = await rpc('workspace_get_invitation', { p_token: token });
  return mapInvitationPreview(unwrapRpc(data));
}

export async function acceptInvitation(token) {
  const data = await rpc('workspace_accept_invitation', { p_token: token });
  return mapAcceptedInvitation(unwrapRpc(data));
}
