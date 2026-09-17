const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET || '';

export const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly'
];

export async function exchangeCodeForTokens(code, redirectUri) {
  const body = new URLSearchParams({ code, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || 'Token exchange failed.');
  return data;
}

export async function accessTokenFromRefresh(refreshToken) {
  const body = new URLSearchParams({ client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), refresh_token: refreshToken, grant_type: 'refresh_token' });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
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
    body: JSON.stringify({ range: { start: civilDate(startDate), end: civilDate(endDate) }, windowSizeDays: 1, dataSourceFamily: 'users/me/dataSourceFamilies/google-sources' })
  });
}

async function listData(accessToken, type, filter) {
  const qs = new URLSearchParams({ pageSize: '1000' });
  if (filter) qs.set('filter', filter);
  return healthFetch(accessToken, `https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints?${qs}`);
}

function dateKeyFromDailyPoint(p) {
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

function median(values) {
  const valid = values.filter(v => Number.isFinite(v));
  if (!valid.length) return null;
  const s = [...valid].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(values) {
  const valid = values.filter(v => Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function stddev(values) {
  const valid = values.filter(v => Number.isFinite(v));
  if (valid.length < 2) return null;
  const avg = mean(valid);
  return Math.sqrt(valid.reduce((s, v) => s + ((v - avg) ** 2), 0) / valid.length);
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function scoreRecovery({ sleepMinutes, hrv, rhr, sleepBaseline, hrvBaseline, rhrBaseline, recentWorkoutMinutes, consistencyScore = 75 }) {
  const sleep = sleepBaseline ? clamp(35 * (sleepMinutes / sleepBaseline), 10, 35) : clamp((sleepMinutes / 480) * 35, 0, 35);
  const hrvScore = hrv && hrvBaseline ? clamp(25 * (hrv / hrvBaseline), 8, 25) : 17;
  const rhrScore = rhr && rhrBaseline ? clamp(20 * (rhrBaseline / rhr), 7, 20) : 14;
  const consistency = clamp(consistencyScore / 10, 2, 10);
  const load = recentWorkoutMinutes > 120 ? 4 : recentWorkoutMinutes > 75 ? 6 : recentWorkoutMinutes > 35 ? 8 : 10;
  return Math.round(clamp(sleep + hrvScore + rhrScore + consistency + load, 0, 100));
}

function scoreSleep(minutesAsleep, minutesInPeriod, sleepBaseline) {
  const target = sleepBaseline && sleepBaseline >= 360 ? sleepBaseline : 480;
  const durationScore = clamp((minutesAsleep / target) * 70, 0, 70);
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

function civilTimeMinutes(civil) {
  const t = civil?.time || civil;
  if (!t || !Number.isFinite(Number(t.hours))) return null;
  let mins = n(t.hours) * 60 + n(t.minutes);
  // Bedtimes around midnight should cluster together instead of appearing 24h apart.
  if (mins < 12 * 60) mins += 24 * 60;
  return mins;
}

function sleepConsistency(mainSleeps) {
  const bedtimes = mainSleeps.map(s => civilTimeMinutes(s.interval?.civilStartTime)).filter(Number.isFinite);
  const sd = stddev(bedtimes);
  if (sd === null) return { score: null, variabilityMinutes: null };
  const variabilityMinutes = Math.round(sd);
  return { score: Math.round(clamp(100 - variabilityMinutes * 0.75, 35, 100)), variabilityMinutes };
}

function overlapMinutes(startA, endA, startB, endB) {
  const a1 = new Date(startA).getTime(), a2 = new Date(endA).getTime(), b1 = new Date(startB).getTime(), b2 = new Date(endB).getTime();
  if (![a1, a2, b1, b2].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round((Math.min(a2, b2) - Math.max(a1, b1)) / 60000));
}

export async function buildDashboard(accessToken, targetDate) {
  const start30 = addDays(targetDate, -29);
  const start28 = addDays(targetDate, -27);
  const start7 = addDays(targetDate, -6);
  const end = addDays(targetDate, 1);

  const calls = await Promise.allSettled([
    dailyRollup(accessToken, 'steps', start30, end),
    dailyRollup(accessToken, 'active-zone-minutes', start30, end),
    dailyRollup(accessToken, 'total-calories', start30, end),
    dailyRollup(accessToken, 'distance', start30, end),
    dailyRollup(accessToken, 'floors', start30, end),
    listData(accessToken, 'daily-heart-rate-variability', `daily_heart_rate_variability.date >= "${start30}" AND daily_heart_rate_variability.date < "${end}"`),
    listData(accessToken, 'daily-resting-heart-rate', `daily_resting_heart_rate.date >= "${start30}" AND daily_resting_heart_rate.date < "${end}"`),
    listData(accessToken, 'sleep', `sleep.interval.civil_end_time >= "${start30}T00:00:00" AND sleep.interval.civil_end_time < "${end}T00:00:00"`),
    listData(accessToken, 'exercise', `exercise.interval.civil_start_time >= "${start30}T00:00:00" AND exercise.interval.civil_start_time < "${end}T00:00:00"`)
  ]);

  const value = i => calls[i].status === 'fulfilled' ? calls[i].value : {};
  const warnings = calls.map((r, i) => r.status === 'rejected' ? { index: i, message: r.reason?.message || String(r.reason) } : null).filter(Boolean);

  const steps = mapRollups(value(0), p => n(p.steps?.countSum));
  const azm = mapRollups(value(1), p => n(p.activeZoneMinutes?.sumInCardioHeartZone) + n(p.activeZoneMinutes?.sumInPeakHeartZone) + n(p.activeZoneMinutes?.sumInFatBurnHeartZone));
  const calories = mapRollups(value(2), p => n(p.totalCalories?.kcalSum));
  const distance = mapRollups(value(3), p => n(p.distance?.millimetersSum) / 1_609_344);
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
  const workoutRows = workouts.slice(0, 40).map(w => ({
    name: formatWorkoutType(w.exerciseType || w.type || w.activityType),
    startTime: w.interval?.startTime,
    endTime: w.interval?.endTime,
    minutes: durationMinutes(w.interval?.startTime, w.interval?.endTime),
    calories: Math.round(n(w.metricsSummary?.caloriesKcal)),
    distanceMiles: n(w.metricsSummary?.distanceMillimeters) / 1_609_344,
    steps: n(w.metricsSummary?.steps),
    avgHr: Math.round(n(w.metricsSummary?.averageHeartRateBeatsPerMinute)),
    activeZoneMinutes: n(w.metricsSummary?.activeZoneMinutes)
  }));

  const allDays = Array.from({ length: 30 }, (_, i) => addDays(start30, i));
  const days7 = allDays.slice(-7);
  const validSleepMinutes = [...sleepByDay.values()].map(s => n(s.summary?.minutesAsleep, NaN)).filter(Number.isFinite);
  const hrvValues = allDays.slice(0, -1).map(d => hrvMap.get(d)).filter(Number.isFinite);
  const rhrValues = allDays.slice(0, -1).map(d => rhrMap.get(d)).filter(Number.isFinite);
  const sleepBaseline = median(validSleepMinutes.slice(1)) || median(validSleepMinutes) || null;
  const hrvBaseline = median(hrvValues) || null;
  const rhrBaseline = median(rhrValues) || null;
  const consistency = sleepConsistency(mainSleeps.slice(0, 30));

  const sleepMinutes = latestSleep ? n(latestSleep.summary?.minutesAsleep) : 0;
  const sleepPeriod = latestSleep ? n(latestSleep.summary?.minutesInSleepPeriod) : 0;
  const hrv = hrvMap.get(targetDate) || [...hrvMap.entries()].sort().at(-1)?.[1] || 0;
  const rhr = rhrMap.get(targetDate) || [...rhrMap.entries()].sort().at(-1)?.[1] || 0;
  const targetMs = new Date(`${targetDate}T23:59:59`).getTime();
  const workoutMinutes36h = workoutRows.filter(w => w.startTime && targetMs - new Date(w.startTime).getTime() >= 0 && targetMs - new Date(w.startTime).getTime() < 36 * 3600_000).reduce((s, w) => s + w.minutes, 0);
  const recoveryScore = scoreRecovery({ sleepMinutes, hrv, rhr, sleepBaseline, hrvBaseline, rhrBaseline, recentWorkoutMinutes: workoutMinutes36h, consistencyScore: consistency.score || 75 });
  const pulseSleepScore = scoreSleep(sleepMinutes, sleepPeriod || sleepMinutes, sleepBaseline);

  const stage = Object.fromEntries((latestSleep?.summary?.stagesSummary || []).map(x => [x.type, n(x.minutes)]));
  const history30 = allDays.map(d => {
    const sl = sleepByDay.get(d);
    const daySleep = n(sl?.summary?.minutesAsleep, NaN);
    const dayHrv = hrvMap.get(d);
    const dayRhr = rhrMap.get(d);
    const recentStart = new Date(`${d}T23:59:59`).getTime() - 36 * 3600_000;
    const recentEnd = new Date(`${d}T23:59:59`).getTime();
    const recentWorkoutMinutes = workoutRows.filter(w => {
      const t = new Date(w.startTime).getTime();
      return Number.isFinite(t) && t >= recentStart && t <= recentEnd;
    }).reduce((s, w) => s + w.minutes, 0);
    const recovery = Number.isFinite(daySleep) || dayHrv || dayRhr ? scoreRecovery({
      sleepMinutes: Number.isFinite(daySleep) ? daySleep : sleepBaseline || 420,
      hrv: dayHrv || hrvBaseline || 45,
      rhr: dayRhr || rhrBaseline || 60,
      sleepBaseline: sleepBaseline || 420,
      hrvBaseline: hrvBaseline || 45,
      rhrBaseline: rhrBaseline || 60,
      recentWorkoutMinutes,
      consistencyScore: consistency.score || 75
    }) : null;
    return {
      date: d,
      steps: steps.get(d) || 0,
      activeZoneMinutes: azm.get(d) || 0,
      calories: Math.round(calories.get(d) || 0),
      distanceMiles: Number((distance.get(d) || 0).toFixed(1)),
      sleepMinutes: Number.isFinite(daySleep) ? daySleep : null,
      hrvMs: dayHrv || null,
      restingHr: dayRhr || null,
      recovery
    };
  });

  const workouts7 = workoutRows.filter(w => w.startTime && w.startTime.slice(0, 10) >= start7);
  const workouts28 = workoutRows.filter(w => w.startTime && w.startTime.slice(0, 10) >= start28);
  const trainingMinutes7 = workouts7.reduce((s, w) => s + w.minutes, 0);
  const trainingMinutes28 = workouts28.reduce((s, w) => s + w.minutes, 0);
  const efficiency = sleepPeriod ? Math.round(clamp((sleepMinutes / sleepPeriod) * 100, 0, 100)) : null;

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
      floors: floors.has(targetDate) ? Math.round(floors.get(targetDate) || 0) : null
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
      sleepConsistencyScore: consistency.score,
      bedtimeVariabilityMinutes: consistency.variabilityMinutes,
      recentWorkoutMinutes: workoutMinutes36h,
      pulseSleepScore
    },
    sleep: latestSleep ? {
      startTime: latestSleep.interval?.startTime,
      endTime: latestSleep.interval?.endTime,
      minutesAsleep: sleepMinutes,
      minutesInPeriod: sleepPeriod,
      minutesAwake: n(latestSleep.summary?.minutesAwake),
      efficiency,
      score: pulseSleepScore,
      stages: { awake: stage.AWAKE || 0, rem: stage.REM || 0, light: stage.LIGHT || 0, deep: stage.DEEP || 0 }
    } : null,
    training: {
      googleMinutes7: trainingMinutes7,
      googleMinutes28: trainingMinutes28,
      latest: workoutRows[0] || null,
      workouts: workoutRows
    },
    trends: {
      days: allDays,
      labels: allDays.map(d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      labels7: days7.map(d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })),
      steps: allDays.map(d => steps.get(d) || 0),
      sleepHours: allDays.map(d => {
        const v = n(sleepByDay.get(d)?.summary?.minutesAsleep, NaN);
        return Number.isFinite(v) ? Number((v / 60).toFixed(1)) : null;
      }),
      recovery: history30.map(x => x.recovery),
      last7: history30.slice(-7)
    },
    baselines: {
      windowDays: 30,
      sleepMinutes: sleepBaseline ? Math.round(sleepBaseline) : null,
      hrvMs: hrvBaseline ? Math.round(hrvBaseline) : null,
      restingHr: rhrBaseline ? Math.round(rhrBaseline) : null,
      sleepConsistencyScore: consistency.score,
      bedtimeVariabilityMinutes: consistency.variabilityMinutes
    },
    history30,
    warnings
  };
}

export { overlapMinutes };

export async function getHeartRateTelemetry(accessToken, startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Invalid heart-rate time range.');
  if (end - start > 12 * 3600_000) throw new Error('Heart-rate detail is limited to a 12-hour session window.');
  const points = [];
  let pageToken = '';
  for (let page = 0; page < 8; page++) {
    const qs = new URLSearchParams({ startTime: start.toISOString(), endTime: end.toISOString(), pageSize: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await healthFetch(accessToken, `https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints?${qs}`);
    points.push(...(data?.dataPoints || []));
    pageToken = data?.nextPageToken || '';
    if (!pageToken) break;
  }
  return points.map(p => ({
    time: p.heartRate?.sampleTime?.physicalTime || null,
    bpm: n(p.heartRate?.beatsPerMinute, NaN)
  })).filter(p => p.time && Number.isFinite(p.bpm)).sort((a,b) => new Date(a.time) - new Date(b.time));
}
