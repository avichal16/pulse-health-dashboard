import { sendJson, redirect } from '../../lib/http.mjs';
import { getStateCookie, clearStateCookie, setRefreshTokenCookie, redirectUri } from '../../lib/session.mjs';
import { exchangeCodeForTokens } from '../../lib/google-health.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const expectedState = getStateCookie(req);
  const returnedState = url.searchParams.get('state');
  if (!expectedState || returnedState !== expectedState) return sendJson(res, 400, { error: 'OAuth state mismatch. Start the connection again.' });

  const oauthError = url.searchParams.get('error');
  if (oauthError) return redirect(res, `/?oauth_error=${encodeURIComponent(oauthError)}`);
  const code = url.searchParams.get('code');
  if (!code) return sendJson(res, 400, { error: 'No authorization code returned by Google.' });

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri(req));
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Reconnect and approve access again.');
    setRefreshTokenCookie(req, res, tokens.refresh_token);
    clearStateCookie(req, res);
    return redirect(res, '/?connected=1');
  } catch (error) {
    clearStateCookie(req, res);
    return redirect(res, `/?oauth_error=${encodeURIComponent(error.message || 'OAuth failed')}`);
  }
}
