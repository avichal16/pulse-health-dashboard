const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET || '';

export const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly'
];

export async function exchangeCodeForTokens(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID(),
    client_secret: CLIENT_SECRET(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || 'Token exchange failed.');
  return data;
}

export async function accessTokenFromRefresh(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID(),
    client_secret: CLIENT_SECRET(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || 'Google authorization expired. Reconnect Google Health.');
  return data.access_token;
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function civilDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } };
}

async function healthFetch(accessToken, url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const message = data?.error?.message || data?.error_description || `Google Health request failed (${r.status})`;
    throw new Error(message);
  }
  return data;
}

async function dailyRollup(accessToken, type, startDate, endDate) {
  return healthFetch(accessToken, `https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints:dailyRollUp`, {
    method: 'POST',
    body: JSON.stringify({
      range: { start: civilDate(startDate), end: civilDate(endDate) },
      windowSizeDays: 1,
      dataSourceFamily: 'users/me/dataSourceFamilies/google-sources'
    })
  });
}

async function listData(accessToken, type, filter) {
  const qs = new URLSearchParams({ pageSize: '1000' });
  if (filter) qs.set('filter', filter);
  return healthFetch(accessToken, `https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints?${qs}`);
}

function dateKeyFromDailyPoint(p) {
  // dailyRollUp responses use civilStartTime/civilEndTime (not start.date).
  // Keep legacy fallbacks so this remains tolerant of older/test payloads.
  const d = p?.civilStartTime?.date || p?.civilEndTime?.date || p?.start?.date || p?.date || p?.dailyHeartRateVariability?.date || p?.dailyRestingHeartRate?.date;
  if (!d) return '';
  return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

function n(v, fallback = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function mapRollups(data, extractor) {
  const out = new Map();
  for (const p of data?.rollupDataPoints || []) {
    const key = dateKeyFromDailyPoint(p);
    if (key) out.set(key, extractor(p));
  }
  return out;
}

function parseCivilDate(d) {
  if (!d) return '';
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

function percentileBaseline(values) {
  const valid = values.filter(v => Number.isFinite(v));
  if (!valid.length) return null;
  const s = [...valid].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function scoreRecovery({ sleepMinutes, hrv, rhr, sleepBaseline, hrvBaseline, rhrBaseline, recentWorkoutMinutes }) {
  const sleep = clamp((sleepMinutes / 480) * 35, 0, 35);
  const hrvScore = hrv && hrvBaseline ? clamp(25 * (hrv / hrvBaseline), 8, 25) : 17;
  const rhrScore = rhr && rhrBaseline ? clamp(20 * (rhrBaseline / rhr), 7, 20) : 14;
  const sleepConsistency = sleepBaseline ? clamp(10 - Math.abs(sleepMinutes - sleepBaseline) / 25, 2, 10) : 7;
  const load = recentWorkoutMinutes > 90 ? 5 : recentWorkoutMinutes > 45 ? 8 : 10;
  return Math.round(clamp(sleep + hrvScore + rhrScore + sleepConsistency + load, 0, 100));
}

function scoreSleep(minutesAsleep, minutesInPeriod) {
  const durationScore = clamp((minutesAsleep / 480) * 70, 0, 70);
  const efficiency = minutesInPeriod ? clamp(minutesAsleep / minutesInPeriod, 0, 1) : 0.9;
  return Math.round(clamp(durationScore + efficiency * 30, 0, 100));
}

function formatWorkoutType(type) {
  if (!type) return 'Workout';
  return String(type).replace(/^EXERCISE_TYPE_/, '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function durationMinutes(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

export async function buildDashboard(accessToken, targetDate) {
  const start7 = addDays(targetDate, -6);
  const start14 = addDays(targetDate, -13);
  const end = addDays(targetDate, 1);

  const calls = await Promise.allSettled([
    dailyRollup(accessToken, 'steps', start7, end),
    dailyRollup(accessToken, 'active-zone-minutes', start7, end),
    dailyRollup(accessToken, 'total-calories', start7, end),
    dailyRollup(accessToken, 'distance', start7, end),
    dailyRollup(accessToken, 'floors', start7, end),
    listData(accessToken, 'daily-heart-rate-variability', `daily_heart_rate_variability.date >= "${start14}" AND daily_heart_rate_variability.date < "${end}"`),
    listData(accessToken, 'daily-resting-heart-rate', `daily_resting_heart_rate.date >= "${start14}" AND daily_resting_heart_rate.date < "${end}"`),
    listData(accessToken, 'sleep', `sleep.interval.civil_end_time >= "${start7}T00:00:00" AND sleep.interval.civil_end_time < "${end}T00:00:00"`),
    listData(accessToken, 'exercise', `exercise.interval.civil_start_time >= "${start7}T00:00:00" AND exercise.interval.civil_start_time < "${end}T00:00:00"`)
  ]);

  const value = i => calls[i].status === 'fulfilled' ? calls[i].value : {};
  const warnings = calls.map((r, i) => r.status === 'rejected' ? { index: i, message: r.reason?.message || String(r.reason) } : null).filter(Boolean);

  const steps = mapRollups(value(0), p => n(p.steps?.countSum));
  const azm = mapRollups(value(1), p => n(p.activeZoneMinutes?.sumInCardioHeartZone) + n(p.activeZoneMinutes?.sumInPeakHeartZone) + n(p.activeZoneMinutes?.sumInFatBurnHeartZone));
  const calories = mapRollups(value(2), p => n(p.totalCalories?.kcalSum));
  const distance = mapRollups(value(3), p => n(p.distance?.millimetersSum) / 1_609_344_000);
  const floors = mapRollups(value(4), p => n(p.floors?.countSum));

  const hrvMap = new Map();
  for (const p of value(5)?.dataPoints || []) {
    const d = parseCivilDate(p.dailyHeartRateVariability?.date);
    const v = n(p.dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds, NaN);
    if (d && Number.isFinite(v)) hrvMap.set(d, v);
  }

  const rhrMap = new Map();
  for (const p of value(6)?.dataPoints || []) {
    const d = parseCivilDate(p.dailyRestingHeartRate?.date);
    const v = n(p.dailyRestingHeartRate?.beatsPerMinute, NaN);
    if (d && Number.isFinite(v)) rhrMap.set(d, v);
  }

  const sleeps = (value(7)?.dataPoints || []).map(p => p.sleep).filter(Boolean).sort((a, b) => new Date(b.interval?.endTime || 0) - new Date(a.interval?.endTime || 0));
  const mainSleeps = sleeps.filter(s => !s.metadata?.nap);
  const latestSleep = mainSleeps[0] || sleeps[0] || null;
  const sleepByDay = new Map();
  for (const s of mainSleeps) {
    const d = parseCivilDate(s.interval?.civilEndTime?.date);
    if (d && !sleepByDay.has(d)) sleepByDay.set(d, s);
  }

  const workouts = (value(8)?.dataPoints || []).map(p => p.exercise).filter(Boolean).sort((a, b) => new Date(b.interval?.startTime || 0) - new Date(a.interval?.startTime || 0));
  const workoutRows = workouts.slice(0, 10).map(w => ({
    name: formatWorkoutType(w.exerciseType || w.type || w.activityType),
    startTime: w.interval?.startTime,
    endTime: w.interval?.endTime,
    minutes: durationMinutes(w.interval?.startTime, w.interval?.endTime),
    calories: Math.round(n(w.metricsSummary?.caloriesKcal)),
    distanceMiles: n(w.metricsSummary?.distanceMillimeters) / 1_609_344_000,
    steps: n(w.metricsSummary?.steps),
    avgHr: Math.round(n(w.metricsSummary?.averageHeartRateBeatsPerMinute)),
    activeZoneMinutes: n(w.metricsSummary?.activeZoneMinutes)
  }));

  const days = Array.from({ length: 7 }, (_, i) => addDays(start7, i));
  const sleepMinutes = latestSleep ? n(latestSleep.summary?.minutesAsleep) : 0;
  const sleepPeriod = latestSleep ? n(latestSleep.summary?.minutesInSleepPeriod) : 0;
  const hrv = hrvMap.get(targetDate) || [...hrvMap.values()].at(-1) || 0;
  const rhr = rhrMap.get(targetDate) || [...rhrMap.values()].at(-1) || 0;
  const sleepBaselines = [...sleepByDay.values()].map(s => n(s.summary?.minutesAsleep));
  const hrvBaseline = percentileBaseline([...hrvMap.values()].slice(0, -1)) || hrv || null;
  const rhrBaseline = percentileBaseline([...rhrMap.values()].slice(0, -1)) || rhr || null;
  const sleepBaseline = percentileBaseline(sleepBaselines.slice(1)) || sleepMinutes || null;
  const workoutMinutes24h = workoutRows.filter(w => w.startTime && Date.now() - new Date(w.startTime).getTime() < 36 * 3600_000).reduce((s, w) => s + w.minutes, 0);
  const recoveryScore = scoreRecovery({ sleepMinutes, hrv, rhr, sleepBaseline, hrvBaseline, rhrBaseline, recentWorkoutMinutes: workoutMinutes24h });
  const pulseSleepScore = scoreSleep(sleepMinutes, sleepPeriod || sleepMinutes);

  const stage = Object.fromEntries((latestSleep?.summary?.stagesSummary || []).map(x => [x.type, n(x.minutes)]));
  const recoveryTrend = days.map(d => {
    const sl = sleepByDay.get(d);
    return scoreRecovery({
      sleepMinutes: n(sl?.summary?.minutesAsleep, sleepBaseline || 420),
      hrv: hrvMap.get(d) || hrvBaseline || 45,
      rhr: rhrMap.get(d) || rhrBaseline || 60,
      sleepBaseline: sleepBaseline || 420,
      hrvBaseline: hrvBaseline || 45,
      rhrBaseline: rhrBaseline || 60,
      recentWorkoutMinutes: 45
    });
  });

  return {
    connected: true,
    source: 'Google Health API',
    syncedAt: new Date().toISOString(),
    date: targetDate,
    today: {
      steps: steps.get(targetDate) || 0,
      stepGoal: 10000,
      activeZoneMinutes: azm.get(targetDate) || 0,
      activeZoneGoal: 45,
      calories: Math.round(calories.get(targetDate) || 0),
      distanceMiles: Number((distance.get(targetDate) || 0).toFixed(1)),
      floors: Math.round(floors.get(targetDate) || 0)
    },
    recovery: {
      score: recoveryScore,
      status: recoveryScore >= 80 ? 'Ready' : recoveryScore >= 65 ? 'Balanced' : 'Recover',
      hrvMs: Math.round(hrv),
      hrvBaseline: hrvBaseline ? Math.round(hrvBaseline) : null,
      restingHr: Math.round(rhr),
      restingHrBaseline: rhrBaseline ? Math.round(rhrBaseline) : null,
      sleepMinutes,
      sleepBaseline: sleepBaseline ? Math.round(sleepBaseline) : null,
      pulseSleepScore
    },
    sleep: latestSleep ? {
      startTime: latestSleep.interval?.startTime,
      endTime: latestSleep.interval?.endTime,
      minutesAsleep: sleepMinutes,
      minutesInPeriod: sleepPeriod,
      minutesAwake: n(latestSleep.summary?.minutesAwake),
      score: pulseSleepScore,
      stages: { awake: stage.AWAKE || 0, rem: stage.REM || 0, light: stage.LIGHT || 0, deep: stage.DEEP || 0 }
    } : null,
    training: {
      load: workoutRows.slice(0, 7).reduce((s, w) => s + w.minutes, 0),
      latest: workoutRows[0] || null,
      workouts: workoutRows
    },
    trends: {
      days,
      labels: days.map(d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })),
      steps: days.map(d => steps.get(d) || 0),
      sleepHours: days.map(d => Number((n(sleepByDay.get(d)?.summary?.minutesAsleep) / 60).toFixed(1))),
      recovery: recoveryTrend
    },
    warnings
  };
}
