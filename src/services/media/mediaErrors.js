const MESSAGE_BY_CODE = Object.freeze({
  '22023': 'The upload request was invalid. Review the file and try again.',
  '23503': 'This image is still in use and cannot be deleted.',
  '28000': 'Sign in again to manage images.',
  '42501': 'You do not have permission to manage this image.',
  '503': 'The image provider is not configured. Contact your administrator.',
  502: 'The image provider could not complete the request. Try again.',
  504: 'The image provider timed out. Try again.',
  PGRST116: 'The image record could not be found.',
});

export class MediaStorageError extends Error {
  constructor(message, { cause, code, status } = {}) {
    super(message, { cause });
    this.name = 'MediaStorageError';
    this.code = code ?? null;
    this.status = status ?? null;
  }
}

export function toMediaStorageError(error) {
  if (error instanceof MediaStorageError) return error;

  const code = String(error?.code ?? '');
  const status = Number(error?.status ?? error?.context?.status ?? 0) || null;
  let message = MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE[status];

  if (!message && /row-level security|permission denied|insufficient privilege/i.test(error?.message ?? '')) {
    message = MESSAGE_BY_CODE['42501'];
  }
  if (!message && /payload too large|exceeded the maximum allowed size|entity too large/i.test(error?.message ?? '')) {
    message = 'Images must be smaller than the configured upload limit.';
  }
  if (!message && /failed to fetch|networkerror|network request failed/i.test(error?.message ?? '')) {
    message = 'The image service could not be reached. Check your connection and try again.';
  }
  if (!message) {
    message = error?.message || 'The media request could not be completed.';
  }

  return new MediaStorageError(message, {
    cause: error,
    code: code || null,
    status,
  });
}

export function formatMediaBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
