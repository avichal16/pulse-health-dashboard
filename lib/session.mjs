import crypto from 'node:crypto';

export const REFRESH_COOKIE = 'pulse_refresh';
export const STATE_COOKIE = 'pulse_oauth_state';

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (!item) continue;
    const i = item.indexOf('=');
    if (i < 0) continue;
    out[decodeURIComponent(item.slice(0, i))] = decodeURIComponent(item.slice(i + 1));
  }
  return out;
}

function keyMaterial() {
  const secret = process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
  if (!secret) throw new Error('Missing SESSION_SECRET or GOOGLE_CLIENT_SECRET.');
  return crypto.createHash('sha256').update(secret).digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url');
}

export function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(tag)}.${b64url(encrypted)}`;
}

export function decryptPayload(value) {
  try {
    if (!value || !value.startsWith('v1.')) return null;
    const [, ivText, tagText, dataText] = value.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), fromB64url(ivText));
    decipher.setAuthTag(fromB64url(tagText));
    const plain = Buffer.concat([decipher.update(fromB64url(dataText)), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

function usesHttps(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwarded) return forwarded === 'https';
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
}

function serializeCookie(name, value, req, { maxAge = 0, httpOnly = true } = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (usesHttps(req)) parts.push('Secure');
  if (maxAge) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const next = !existing ? [cookie] : Array.isArray(existing) ? [...existing, cookie] : [existing, cookie];
  res.setHeader('Set-Cookie', next);
}

export function setRefreshTokenCookie(req, res, refreshToken) {
  const encrypted = encryptPayload({ refreshToken, issuedAt: Date.now() });
  appendSetCookie(res, serializeCookie(REFRESH_COOKIE, encrypted, req, { maxAge: 60 * 60 * 24 * 90 }));
}

export function getRefreshToken(req) {
  const encrypted = parseCookies(req)[REFRESH_COOKIE];
  const payload = decryptPayload(encrypted);
  return payload?.refreshToken || null;
}

export function clearRefreshTokenCookie(req, res) {
  appendSetCookie(res, serializeCookie(REFRESH_COOKIE, '', req, { maxAge: 0 }));
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : [existing];
  const last = list.pop();
  list.push(`${last}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  res.setHeader('Set-Cookie', list);
}

export function setStateCookie(req, res, state) {
  appendSetCookie(res, serializeCookie(STATE_COOKIE, state, req, { maxAge: 600 }));
}

export function getStateCookie(req) {
  return parseCookies(req)[STATE_COOKIE] || null;
}

export function clearStateCookie(req, res) {
  appendSetCookie(res, `${serializeCookie(STATE_COOKIE, '', req, { maxAge: 0 })}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

export function requestOrigin(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8000').split(',')[0].trim();
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

export function redirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${requestOrigin(req)}/api/oauth/callback`;
}
