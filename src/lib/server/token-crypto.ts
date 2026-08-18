import crypto from 'crypto';

const ENCRYPTED_PREFIX = 'enc:v1';
const LEGACY_TOKEN_SECRET = 'anton-ia-token-secret';

function getConfiguredTokenSecrets() {
  return Array.from(new Set([
    String(process.env.TOKEN_ENCRYPTION_SECRET || '').trim(),
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    String(process.env.INTERNAL_API_SECRET || '').trim(),
  ].filter(Boolean)));
}

function getPrimaryTokenSecret() {
  const [secret] = getConfiguredTokenSecrets();
  if (!secret) throw new Error('TOKEN_ENCRYPTION_SECRET, SUPABASE_SERVICE_ROLE_KEY, or INTERNAL_API_SECRET is required.');
  return secret;
}

function getKey(secret: string) {
  return crypto.createHash('sha256').update(secret).digest();
}

function toBase64Url(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function isEncryptedStoredToken(value: string | null | undefined) {
  return String(value || '').startsWith(`${ENCRYPTED_PREFIX}.`);
}

export function encryptStoredToken(refreshToken: string) {
  const plain = String(refreshToken || '');
  if (!plain) return plain;
  if (isEncryptedStoredToken(plain)) return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(getPrimaryTokenSecret()), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}.${toBase64Url(iv)}.${toBase64Url(tag)}.${toBase64Url(encrypted)}`;
}

export function decryptStoredToken(refreshToken: string | null | undefined) {
  const raw = String(refreshToken || '');
  if (!raw) return null;
  if (!isEncryptedStoredToken(raw)) return raw;

  const parts = raw.split('.');
  if (parts.length !== 4) return null;

  try {
    const iv = fromBase64Url(parts[1]);
    const tag = fromBase64Url(parts[2]);
    const encrypted = fromBase64Url(parts[3]);

    // Retain the retired literal only for decrypting records written by older releases.
    for (const secret of [...getConfiguredTokenSecrets(), LEGACY_TOKEN_SECRET]) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(secret), iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
      } catch {
        // try next secret candidate
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function decryptTokenRecord<T extends { refresh_token?: string | null }>(record: T): T {
  if (!record?.refresh_token) return record;
  const decrypted = decryptStoredToken(record.refresh_token);
  return {
    ...record,
    refresh_token: decrypted || '',
  };
}

export function decryptTokenRecords<T extends { refresh_token?: string | null }>(records: T[] | null | undefined): T[] {
  return (records || []).map((record) => decryptTokenRecord(record));
}
