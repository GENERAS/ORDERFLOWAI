export function isBlank(value) {
  return value == null || String(value).trim().length === 0;
}

export function isValidEmail(value) {
  if (isBlank(value)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

export function isValidPhone(value) {
  if (isBlank(value)) return false;
  return /^\+?[0-9\s().-]{7,20}$/.test(String(value).trim());
}

export function toTrimmedString(value, fallback = '') {
  return isBlank(value) ? fallback : String(value).trim();
}

export const MIN_PASSWORD_LENGTH = 8;

export function isValidPassword(value) {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH;
}

export function isValidFullName(value) {
  const normalized = toTrimmedString(value);
  return normalized.length >= 1 && normalized.length <= 160;
}

export function isValidBusinessName(value) {
  const normalized = toTrimmedString(value);
  return normalized.length >= 1 && normalized.length <= 160;
}

export function isValidBusinessSlug(value) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(value ?? '')) &&
    String(value).length >= 2 &&
    String(value).length <= 80;
}
