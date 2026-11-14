export function getPostAuthPath({ memberships = [], activeBusinessId = null } = {}) {
  if (memberships.length === 0) return '/onboarding';
  if (memberships.length > 1 && !activeBusinessId) return '/workspaces';
  return '/overview';
}

export function getSafeDestination(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}
