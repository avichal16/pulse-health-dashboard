import { sendJson } from '../lib/http.mjs';
import { getRefreshToken, redirectUri } from '../lib/session.mjs';
import { SCOPES } from '../lib/google-health.mjs';

export default async function handler(req, res) {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return sendJson(res, 200, {
    configured,
    connected: Boolean(configured && getRefreshToken(req)),
    redirectUri: redirectUri(req),
    scopes: SCOPES,
    deployment: process.env.VERCEL ? 'vercel' : 'local'
  });
}
