export function buildAppUrl(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalizedPath, window.location.origin).toString();
}
