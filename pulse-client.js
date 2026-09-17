const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const charts = {};
let liveData = null;
let healthConnected = false;
let deferredInstallPrompt = null;
const oauthError = new URLSearchParams(window.location.search).get('oauth_error');

function showView(target) {
  views.forEach(v => v.classList.toggle('active', v.dataset.view === target));
  navItems.forEach(n => n.classList.toggle('active', n.dataset.target === target));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(initCharts, 50);
}

navItems.forEach(item => item.addEventListener('click', () => showView(item.dataset.target)));
document.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.jump)));

const today = new Date();
const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
document.getElementById('dateLabel').textContent = today.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });

Chart.defaults.color = '#8f9bad';
Chart.defaults.borderColor = 'rgba(255,255,255,.07)';
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';

function baseOptions() {
  return {
    responsive:true,
    maintainAspectRatio:false,
    plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:'#1c2430', titleColor:'#f4f7fb', bodyColor:'#f4f7fb', borderColor:'rgba(255,255,255,.08)', borderWidth:1 } },
    scales:{
      x:{ grid:{ display:false }, ticks:{ color:'#7f8a9c' } },
      y:{ grid:{ color:'rgba(255,255,255,.06)' }, ticks:{ color:'#7f8a9c' }, beginAtZero:false }
    }
  };
}

const mockTrends = {
  labels:['Thu','Fri','Sat','Sun','Mon','Tue','Wed'],
  recovery:[71,68,75,73,79,77,82],
  sleepHours:[6.8,7.2,8.1,7.6,6.9,7.3,7.7],
  steps:[8210,10432,11984,9034,7322,12543,6842]
};

function chartData() { return liveData?.trends || mockTrends; }

function destroyChart(name) {
  if (charts[name]) { charts[name].destroy(); delete charts[name]; }
}

function initCharts(force = false) {
  const d = chartData();
  if (force) ['recovery','sleep','steps','workout'].forEach(destroyChart);

  if (document.getElementById('recoveryChart') && !charts.recovery) {
    charts.recovery = new Chart(document.getElementById('recoveryChart'), {
      type:'line', data:{ labels:d.labels, datasets:[{ data:d.recovery, borderColor:'#8ef0c7', backgroundColor:'rgba(142,240,199,.12)', fill:true, tension:.38, pointRadius:3, pointBackgroundColor:'#8ef0c7' }] },
      options:{ ...baseOptions(), scales:{ x:baseOptions().scales.x, y:{ ...baseOptions().scales.y, min:40, max:100 } } }
    });
  }
  if (document.getElementById('sleepChart') && !charts.sleep) {
    charts.sleep = new Chart(document.getElementById('sleepChart'), {
      type:'bar', data:{ labels:d.labels, datasets:[{ data:d.sleepHours, backgroundColor:'rgba(122,184,255,.75)', borderRadius:8 }] },
      options:{ ...baseOptions(), scales:{ x:baseOptions().scales.x, y:{ ...baseOptions().scales.y, min:0, max:10 } } }
    });
  }
  if (document.getElementById('stepsChart') && !charts.steps) {
    const vals = d.steps || [];
    charts.steps = new Chart(document.getElementById('stepsChart'), {
      type:'bar', data:{ labels:d.labels, datasets:[{ data:vals, backgroundColor:vals.map((_,i) => i === vals.length-1 ? '#8ef0c7' : 'rgba(142,240,199,.55)'), borderRadius:8 }] },
      options:{ ...baseOptions(), scales:{ x:baseOptions().scales.x, y:{ ...baseOptions().scales.y, beginAtZero:true } } }
    });
  }
  if (document.getElementById('workoutChart') && !charts.workout) {
    charts.workout = new Chart(document.getElementById('workoutChart'), {
      type:'line', data:{ labels:['0','10','20','30','40','50','60'], datasets:[{ data:[91,118,132,146,138,154,127], borderColor:'#7ab8ff', backgroundColor:'rgba(122,184,255,.12)', fill:true, tension:.4, pointRadius:0 }] },
      options:{ ...baseOptions(), scales:{ x:{ ...baseOptions().scales.x, title:{ display:true, text:'Minutes', color:'#657083' } }, y:{ ...baseOptions().scales.y, min:70, max:180 } } }
    });
  }
}

function minutesDisplay(total) {
  total = Math.max(0, Math.round(Number(total) || 0));
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`;
}

function pct(now, goal) {
  if (!goal) return 0;
  return Math.max(0, Math.min(100, Math.round((now / goal) * 100)));
}

function signedPct(value, baseline) {
  if (!value || !baseline) return 'Baseline building';
  const diff = Math.round(((value - baseline) / baseline) * 100);
  return `${diff >= 0 ? '+' : ''}${diff}% vs baseline`;
}

function signedNumber(value, baseline, unit='') {
  if (!value || !baseline) return 'Baseline building';
  const diff = Math.round(value - baseline);
  if (diff === 0) return 'At baseline';
  return `${Math.abs(diff)}${unit} ${diff < 0 ? 'lower' : 'higher'}`;
}

function getByPath(obj, path) { return path.split('.').reduce((v,k) => v?.[k], obj); }

function qualityLabel(score) {
  if (score >= 85) return 'Very good';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Fair';
  return 'Needs recovery';
}

function hydrate(data) {
  liveData = data;
  const shaped = {
    ...data,
    recovery: {
      ...data.recovery,
      sleepDisplay: minutesDisplay(data.recovery.sleepMinutes),
      hrvDisplay: `${Math.round(data.recovery.hrvMs || 0)} ms`,
      rhrDisplay: `${Math.round(data.recovery.restingHr || 0)} bpm`
    },
    today: {
      ...data.today,
      stepsFormatted: Number(data.today.steps || 0).toLocaleString(),
      caloriesFormatted: Number(data.today.calories || 0).toLocaleString(),
      azmDisplay: `${Math.round(data.today.activeZoneMinutes || 0)} min`,
      floorsDisplay: data.today.floors === null || data.today.floors === undefined ? '—' : String(Math.round(data.today.floors))
    }
  };

  document.querySelectorAll('[data-bind]').forEach(el => {
    const v = getByPath(shaped, el.dataset.bind);
    if (v !== undefined && v !== null) el.textContent = v;
  });

  const score = data.recovery.score || 0;
  const ring = document.querySelector('#recoveryRing .ring-progress');
  if (ring) ring.setAttribute('stroke-dasharray', `${score} 100`);
  document.getElementById('recoveryRing')?.setAttribute('aria-label', `Recovery score ${score}`);
  document.getElementById('recoveryHeadline').textContent = score >= 80 ? 'Good day to train' : score >= 65 ? 'Train normally' : 'Prioritize recovery';
  document.getElementById('recoverySummary').textContent = score >= 80 ? 'Your overnight signals are favorable relative to your personal baseline.' : score >= 65 ? 'Your signals are near baseline. Normal training should be reasonable.' : 'Sleep or cardiovascular recovery signals are below your recent baseline.';

  document.getElementById('sleepDelta').textContent = data.recovery.sleepBaseline ? signedNumber(data.recovery.sleepMinutes, data.recovery.sleepBaseline, ' min') : 'Baseline building';
  document.getElementById('hrvDelta').textContent = signedPct(data.recovery.hrvMs, data.recovery.hrvBaseline);
  document.getElementById('rhrDelta').textContent = signedNumber(data.recovery.restingHr, data.recovery.restingHrBaseline, ' bpm');
  document.getElementById('sleepQuality').textContent = qualityLabel(data.recovery.pulseSleepScore);

  const sp = pct(data.today.steps, data.today.stepGoal);
  const ap = pct(data.today.activeZoneMinutes, data.today.activeZoneGoal);
  document.getElementById('stepsPct').textContent = `${sp}%`;
  document.getElementById('stepsProgress').style.width = `${sp}%`;
  document.getElementById('stepsGoal').textContent = `Goal: ${Number(data.today.stepGoal).toLocaleString()}`;
  document.getElementById('azmPct').textContent = `${ap}%`;
  document.getElementById('azmProgress').style.width = `${ap}%`;
  document.getElementById('azmGoal').textContent = `Goal: ${data.today.activeZoneGoal} min`;
  document.getElementById('activityStepGoal').textContent = `of ${Number(data.today.stepGoal).toLocaleString()}`;
  document.getElementById('activityStepsPct').textContent = `${sp}%`;
  document.getElementById('stepRing').style.background = `radial-gradient(circle at center, var(--surface) 56%, transparent 57%), conic-gradient(var(--accent) ${sp}%, rgba(255,255,255,.07) 0)`;
  document.getElementById('activityAzmGoal').textContent = `Goal ${data.today.activeZoneGoal} min`;
  document.getElementById('activityDistance').textContent = `${Number(data.today.distanceMiles || 0).toFixed(1)} mi`;
  const floorsUnit = document.getElementById('floorsUnit');
  if (floorsUnit) floorsUnit.textContent = data.today.floors === null || data.today.floors === undefined ? 'not tracked' : 'floors';

  const latest = data.training.latest;
  if (latest) {
    document.getElementById('latestWorkoutName').textContent = latest.name;
    document.getElementById('latestWorkoutMeta').textContent = `${new Date(latest.startTime).toLocaleDateString('en-US',{weekday:'short'})} · ${minutesDisplay(latest.minutes)}`;
    document.getElementById('latestWorkoutCalories').textContent = Math.round(latest.calories || 0);
    document.getElementById('latestWorkoutHr').textContent = latest.avgHr ? `${latest.avgHr} bpm` : '—';
    document.getElementById('latestWorkoutDuration').textContent = `${latest.minutes} min`;
    document.getElementById('latestWorkoutAzm').textContent = `${latest.activeZoneMinutes || 0} min`;
  } else {
    document.getElementById('latestWorkoutName').textContent = 'No workout yet';
    document.getElementById('latestWorkoutMeta').textContent = 'Recent Google Health history';
    document.getElementById('latestWorkoutCalories').textContent = '—';
    document.getElementById('latestWorkoutHr').textContent = '—';
    document.getElementById('latestWorkoutDuration').textContent = '—';
    document.getElementById('latestWorkoutAzm').textContent = '—';
  }

  document.getElementById('recoveryHrvDetail').textContent = `${Math.round(data.recovery.hrvMs || 0)} ms · ${signedPct(data.recovery.hrvMs, data.recovery.hrvBaseline)}`;
  document.getElementById('recoveryRhrDetail').textContent = `${Math.round(data.recovery.restingHr || 0)} bpm · ${signedNumber(data.recovery.restingHr, data.recovery.restingHrBaseline)}`;
  document.getElementById('factorSleep').textContent = '+35 max';
  document.getElementById('factorHrv').textContent = '+25 max';
  document.getElementById('factorRhr').textContent = '+20 max';

  if (data.sleep) {
    document.getElementById('sleepWindow').textContent = `${new Date(data.sleep.startTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} – ${new Date(data.sleep.endTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · ${minutesDisplay(data.sleep.minutesAsleep)} asleep`;
    const stages = data.sleep.stages || {};
    const stageTotal = Object.values(stages).reduce((s,v) => s + Number(v || 0), 0) || 1;
    Object.entries(stages).forEach(([key,val]) => {
      const valueEl = document.querySelector(`[data-stage-value="${key}"]`);
      const bar = document.querySelector(`[data-stage="${key}"] .stage-bar i`);
      if (valueEl) valueEl.textContent = minutesDisplay(val);
      if (bar) bar.style.width = `${Math.round((Number(val || 0) / stageTotal) * 100)}%`;
    });
  }

  document.getElementById('trainingLoad').textContent = data.training.load || 0;
  document.getElementById('trainingLoadStatus').textContent = data.training.load > 420 ? 'High' : data.training.load > 180 ? 'Moderate' : 'Light';
  const list = document.getElementById('workoutList');
  if (data.training.workouts?.length) {
    list.innerHTML = data.training.workouts.map(w => {
      const metric = w.calories ? `${Math.round(w.calories)}<span>kcal</span>` : w.distanceMiles ? `${w.distanceMiles.toFixed(1)}<span>mi</span>` : `${w.minutes}<span>min</span>`;
      return `<article class="workout-row"><div class="workout-icon">${w.name.charAt(0)}</div><div><h3>${escapeHtml(w.name)}</h3><p>${new Date(w.startTime).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${minutesDisplay(w.minutes)}</p></div><div class="right"><strong>${metric}</strong></div></article>`;
    }).join('');
  } else list.innerHTML = '<article class="workout-row"><div class="workout-icon">—</div><div><h3>No workouts found</h3><p>Google Health returned no exercise sessions in the last 7 days.</p></div></article>';

  initCharts(true);
}

function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

async function loadStatus() {
  const card = document.getElementById('connectionCard');
  const button = document.getElementById('connectButton');
  const title = document.getElementById('connectionTitle');
  const subtitle = document.getElementById('connectionSubtitle');
  try {
    const status = await fetch('/api/status', { cache:'no-store' }).then(r => r.json());
    if (!status.configured) {
      healthConnected = false;
      title.textContent = 'Demo data';
      subtitle.textContent = status.deployment === 'vercel' ? 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel Environment Variables.' : 'Add your Google Health OAuth credentials to enable live Fitbit Air data.';
      button.textContent = 'Setup';
      button.onclick = () => alert(status.deployment === 'vercel' ? 'In Vercel: Project → Settings → Environment Variables. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET, then redeploy.' : 'Open README.md and add your Google OAuth credentials before starting the server.');
      updateSettingsState();
      return;
    }
    if (status.connected) {
      healthConnected = true;
      card.classList.add('connected');
      title.textContent = 'Fitbit Air connected';
      subtitle.textContent = 'Syncing from Google Health…';
      button.textContent = 'Sync';
      button.onclick = loadDashboard;
      await loadDashboard();
    } else {
      healthConnected = false;
      card.classList.remove('connected');
      title.textContent = oauthError ? 'Google Health connection failed' : 'Google Health ready';
      subtitle.textContent = oauthError ? decodeURIComponent(oauthError) : 'Connect once to load your Fitbit Air health history.';
      button.textContent = 'Connect';
      button.onclick = () => { window.location.href = '/api/auth/google'; };
      if (oauthError) subtitle.classList.add('sync-error');
    }
    updateSettingsState();
  } catch {
    healthConnected = false;
    title.textContent = 'Static demo';
    subtitle.textContent = 'The API is unavailable. Deploy on Vercel or run the local server to enable Google Health connectivity.';
    button.textContent = 'Demo';
    button.disabled = true;
    updateSettingsState();
  }
}

async function loadDashboard() {
  const button = document.getElementById('connectButton');
  const subtitle = document.getElementById('connectionSubtitle');
  button.disabled = true;
  button.textContent = 'Syncing';
  try {
    const r = await fetch(`/api/dashboard?date=${todayKey}`, { cache:'no-store' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not sync Google Health');
    hydrate(data);
    subtitle.classList.remove('sync-error');
    subtitle.textContent = `Google Health · synced ${new Date(data.syncedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
    button.textContent = 'Sync';
  } catch (e) {
    subtitle.classList.add('sync-error');
    subtitle.textContent = e.message;
    button.textContent = 'Retry';
  } finally { button.disabled = false; }
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

async function installPulse() {
  if (isStandalone()) return;
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    document.getElementById('installButton').hidden = true;
    updateSettingsState();
    return;
  }
  alert('In Chrome on Android, open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.');
}

function setSheet(open) {
  const sheet = document.getElementById('settingsSheet');
  sheet.hidden = !open;
  document.body.classList.toggle('sheet-open', open);
}

function updateSettingsState() {
  const install = document.getElementById('settingsInstall');
  const sync = document.getElementById('settingsSync');
  const disconnect = document.getElementById('settingsDisconnect');
  if (!install || !sync || !disconnect) return;
  install.disabled = isStandalone();
  install.querySelector('strong').textContent = isStandalone() ? 'Pulse installed' : 'Install Pulse';
  install.querySelector('small').textContent = isStandalone() ? 'Running as an installed app' : 'Add it to your phone home screen';
  sync.disabled = !healthConnected;
  disconnect.disabled = !healthConnected;
}

async function disconnectGoogleHealth() {
  if (!healthConnected) return;
  if (!confirm('Disconnect Google Health from Pulse on this device?')) return;
  try {
    await fetch('/api/logout', { method:'POST', cache:'no-store' });
  } finally {
    window.location.replace('/');
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isStandalone()) document.getElementById('installButton').hidden = false;
  updateSettingsState();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('installButton').hidden = true;
  updateSettingsState();
});

document.getElementById('installButton').addEventListener('click', installPulse);
document.getElementById('settingsButton').addEventListener('click', () => { updateSettingsState(); setSheet(true); });
document.getElementById('settingsClose').addEventListener('click', () => setSheet(false));
document.getElementById('settingsBackdrop').addEventListener('click', () => setSheet(false));
document.getElementById('settingsInstall').addEventListener('click', installPulse);
document.getElementById('settingsSync').addEventListener('click', async () => { setSheet(false); await loadDashboard(); });
document.getElementById('settingsDisconnect').addEventListener('click', disconnectGoogleHealth);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

if (oauthError) history.replaceState({}, '', '/');
initCharts();
loadStatus();
updateSettingsState();
