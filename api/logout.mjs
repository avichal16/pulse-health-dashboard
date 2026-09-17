import { sendJson } from '../lib/http.mjs';
import { clearRefreshTokenCookie } from '../lib/session.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  clearRefreshTokenCookie(req, res);
  return sendJson(res, 200, { ok: true });
}
