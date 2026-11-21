import crypto from 'crypto';
import path from 'path';

const EPHEMERAL_AUTH_SECRET = crypto.randomBytes(32).toString('hex');
const EPHEMERAL_FILE_SECRET = crypto.randomBytes(32).toString('hex');

function getAuthSecret(): string {
  return process.env.AUTH_SECRET && process.env.AUTH_SECRET.trim().length >= 16
    ? process.env.AUTH_SECRET.trim()
    : EPHEMERAL_AUTH_SECRET;
}

function getFileSecret(): string {
  return process.env.FILE_SIGNING_SECRET && process.env.FILE_SIGNING_SECRET.trim().length >= 16
    ? process.env.FILE_SIGNING_SECRET.trim()
    : EPHEMERAL_FILE_SECRET;
}

export function normalizeCorporateEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeCorporateEmail(email);
  if (!normalized || normalized.length > 254) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized);
}

export function isValidMipersaEmail(email: string): boolean {
  const normalized = normalizeCorporateEmail(email);
  return /^[a-z0-9._%+-]+@mipersa\.pe$/.test(normalized);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateRandomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export interface SessionPayload {
  uid: string;
  email: string;
  purpose: 'session' | 'mfa';
  exp: number;
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlSeconds: number): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string, expectedPurpose: 'session' | 'mfa' = 'session'): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || parsed.purpose !== expectedPurpose) return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function signFileUrl(fileId: string, ttlSeconds = 900): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = crypto
    .createHmac('sha256', getFileSecret())
    .update(`${fileId}:${exp}`)
    .digest('base64url');
  return `/api/files/${encodeURIComponent(fileId)}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(fileId: string, expParam: string, sigParam: string): boolean {
  const exp = Number(expParam);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expectedSig = crypto
    .createHmac('sha256', getFileSecret())
    .update(`${fileId}:${exp}`)
    .digest('base64url');
  const a = Buffer.from(sigParam || '');
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface QuickActionPayload {
  solicitudId: string;
  tecnicoId: string;
  accion: 'ACEPTAR' | 'RECHAZAR';
  purpose: 'quick-action';
  exp: number;
}

export function signQuickActionToken(
  payload: Omit<QuickActionPayload, 'purpose' | 'exp'>,
  ttlSeconds = 7 * 24 * 3600
): string {
  const fullPayload: QuickActionPayload = {
    ...payload,
    purpose: 'quick-action',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`qa:${encoded}`)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyQuickActionToken(token: string): QuickActionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`qa:${encoded}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as QuickActionPayload;
    if (!parsed || parsed.purpose !== 'quick-action') return null;
    if (parsed.accion !== 'ACEPTAR' && parsed.accion !== 'RECHAZAR') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Base32 & RFC 6238 TOTP for 2FA MFA
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += BASE32_ALPHABET[bytes[i] % 32];
  }
  return out;
}

function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpCode(secret: string, counterOffset = 0): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + counterOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const cleaned = (code || '').trim();
  if (!/^\d{6}$/.test(cleaned)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = generateTotpCode(secret, offset);
    if (crypto.timingSafeEqual(Buffer.from(cleaned), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export function buildTotpUri(email: string, secret: string, issuer = 'Gestor de Visitas MIPERSA'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

export function isSafeReturnTo(target: string | undefined | null): string {
  if (!target || typeof target !== 'string') return '/solicitudes';
  const trimmed = target.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/solicitudes';
  }
  return trimmed;
}

export function resolveSafeUploadPath(baseDir: string, storageName: string): string {
  const resolvedBase = path.resolve(baseDir);
  const cleanName = path.basename(storageName);
  const resolved = path.resolve(resolvedBase, cleanName);
  if (!resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error('Ruta de archivo fuera del directorio seguro');
  }
  return resolved;
}
