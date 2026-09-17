import { sendJson } from '../lib/http.mjs';
import { getRefreshToken } from '../lib/session.mjs';
import { accessTokenFromRefresh, buildDashboard } from '../lib/google-health.mjs';

function localDateKey() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

export default async function handler(req, res) {
  const refreshToken = getRefreshToken(req);
  if (!refreshToken) return sendJson(res, 401, { connected: false, error: 'Connect Google Health first.' });
  const url = new URL(req.url, 'http://localhost');
  const date = url.searchParams.get('date') || localDateKey();
  try {
    const accessToken = await accessTokenFromRefresh(refreshToken);
    return sendJson(res, 200, await buildDashboard(accessToken, date));
  } catch (error) {
    return sendJson(res, 502, { connected: true, error: error.message || 'Could not sync Google Health.' });
  }
}
