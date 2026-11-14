export function slugify(value, { maxLength = 60 } = {}) {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return normalized;
}

export function createWorkspaceSlug(name, suffix) {
  const base = slugify(name, { maxLength: 60 }) || 'workspace';
  const safeSuffix = slugify(suffix, { maxLength: 12 }) || 'workspace';
  return `${base}-${safeSuffix}`.slice(0, 80).replace(/-+$/g, '');
}
