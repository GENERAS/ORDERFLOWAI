const SHA256_HEADER = /^sha256=([0-9a-f]{64})$/i;

export function toHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes[index] = byte;
  }
  return bytes;
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyMetaSignature(secret, rawBody, header) {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof rawBody !== 'string') return false;
  if (typeof header !== 'string') return false;

  const match = SHA256_HEADER.exec(header);
  if (!match) return false;

  const expected = hexToBytes(match[1]);
  const subtle = globalThis.crypto?.subtle;
  if (!expected || !subtle) return false;

  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('HMAC', key, encoder.encode(rawBody));
  return constantTimeEqual(new Uint8Array(signature), expected);
}
