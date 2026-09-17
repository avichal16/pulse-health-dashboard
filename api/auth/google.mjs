import crypto from 'node:crypto';
import { sendJson, redirect } from '../../lib/http.mjs';
import { setStateCookie, redirectUri } from '../../lib/session.mjs';
import { SCOPES } from '../../lib/google-health.mjs';

export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return sendJson(res, 400, { error: 'Google OAuth credentials are not configured.' });

  const state = crypto.randomBytes(24).toString('hex');
  setStateCookie(req, res, state);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    scope: SCOPES.join(' '),
    state
  });
  return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}
