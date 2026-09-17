import { sendJson } from '../lib/http.mjs';
import { getRefreshToken } from '../lib/session.mjs';
import { accessTokenFromRefresh, getHeartRateTelemetry } from '../lib/google-health.mjs';

export default async function handler(req, res) {
  const refreshToken = getRefreshToken(req);
  if (!refreshToken) return sendJson(res, 401, { connected: false, error: 'Connect Google Health first.' });
  const url = new URL(req.url, 'http://localhost');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) return sendJson(res, 400, { error: 'start and end are required.' });
  try {
    const accessToken = await accessTokenFromRefresh(refreshToken);
    const points = await getHeartRateTelemetry(accessToken, start, end);
    return sendJson(res, 200, { points });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || 'Could not load heart-rate telemetry.' });
  }
}
