const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const charts = {};
let liveData = null;
let healthConnected = false;
let deferredInstallPrompt = null;
let activeWorkout = null;
let workoutTicker = null;
let restTicker = null;
let restEndsAt = null;
const oauthError = new URLSearchParams(window.location.search).get('oauth_error');

const STORAGE = {
  workouts: 'pulse_strength_workouts_v2',
  templates: 'pulse_custom_templates_v2',
  goals: 'pulse_training_goals_v2',
  active: 'pulse_active_workout_v2'
};

const EXERCISES = [
  ['Bench Press','Chest'],['Incline Dumbbell Press','Chest'],['Chest Fly','Chest'],['Push-up','Chest'],
  ['Overhead Press','Shoulders'],['Lateral Raise','Shoulders'],['Rear Delt Fly','Shoulders'],['Face Pull','Shoulders'],
  ['Pull-up','Back'],['Lat Pulldown','Back'],['Barbell Row','Back'],['Seated Cable Row','Back'],['One-arm Dumbbell Row','Back'],
  ['Triceps Pushdown','Triceps'],['Skull Crusher','Triceps'],['Barbell Curl','Biceps'],['Dumbbell Curl','Biceps'],['Hammer Curl','Biceps'],
  ['Back Squat','Quads'],['Leg Press','Quads'],['Leg Extension','Quads'],['Romanian Deadlift','Hamstrings'],['Leg Curl','Hamstrings'],
  ['Deadlift','Posterior Chain'],['Hip Thrust','Glutes'],['Bulgarian Split Squat','Glutes'],['Calf Raise','Calves'],['Plank','Core'],['Cable Crunch','Core']
].map(([name,muscle],i)=>({id:`exercise-${i+1}`,name,muscle}));

const DEFAULT_TEMPLATES = [
  {id:'push',name:'Push',description:'Chest · shoulders · triceps',exercises:['Bench Press','Incline Dumbbell Press','Overhead Press','Lateral Raise','Triceps Pushdown']},
  {id:'pull',name:'Pull',description:'Back · biceps · rear delts',exercises:['Pull-up','Barbell Row','Lat Pulldown','Face Pull','Barbell Curl','Hammer Curl']},
  {id:'legs',name:'Legs',description:'Quads · hamstrings · glutes',exercises:['Back Squat','Romanian Deadlift','Leg Press','Leg Curl','Calf Raise']}
];

const DEFAULT_GOALS = { workoutsPerWeek:4, workingSetsPerWeek:60, stepGoal:10000, activeZoneGoal:45 };

function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function getWorkouts() { return readJson(STORAGE.workouts, []); }
function saveWorkouts(v) { writeJson(STORAGE.workouts, v); }
function getGoals() { return { ...DEFAULT_GOALS, ...readJson(STORAGE.goals, {}) }; }
function saveGoals(v) { writeJson(STORAGE.goals, v); }
function getCustomTemplates() { return readJson(STORAGE.templates, []); }
function getTemplates() { return [...DEFAULT_TEMPLATES, ...getCustomTemplates()]; }
function saveCustomTemplates(v) { writeJson(STORAGE.templates, v); }

function showView(target) {
  views.forEach(v => v.classList.toggle('active', v.dataset.view === target));
  navItems.forEach(n => n.classList.toggle('active', n.dataset.target === target));
  window.scrollTo({ top:0, behavior:'smooth' });
  if (target === 'train') renderTraining();
  setTimeout(initCharts, 50);
}
navItems.forEach(item => item.addEventListener('click', () => showView(item.dataset.target)));
document.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.jump)));

const today = new Date();
const todayKey = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
document.getElementById('dateLabel').textContent = today.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});

if (window.Chart) {
  Chart.defaults.color='#8f9bad';
  Chart.defaults.borderColor='rgba(255,255,255,.07)';
  Chart.defaults.font.family='Inter, system-ui, sans-serif';
}
function baseOptions(){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c2430',titleColor:'#f4f7fb',bodyColor:'#f4f7fb',borderColor:'rgba(255,255,255,.08)',borderWidth:1}},scales:{x:{grid:{display:false},ticks:{color:'#7f8a9c',maxTicksLimit:7}},y:{grid:{color:'rgba(255,255,255,.06)'},ticks:{color:'#7f8a9c'},beginAtZero:false}}}}
function destroyChart(name){if(charts[name]){charts[name].destroy();delete charts[name]}}
function chartData(){
  if(liveData?.trends) return liveData.trends;
  const labels=Array.from({length:30},(_,i)=>`${i+1}`);
  return{labels,recovery:labels.map((_,i)=>70+Math.sin(i/3)*8),sleepHours:labels.map((_,i)=>7+Math.sin(i/4)*.5),steps:labels.map((_,i)=>8000+Math.round(Math.sin(i/3)*2200))};
}
function initCharts(force=false){
  if(!window.Chart)return;
  if(force)['recovery','sleep','steps','strength'].forEach(destroyChart);
  const d=chartData();
  if(document.getElementById('recoveryChart')&&!charts.recovery){charts.recovery=new Chart(document.getElementById('recoveryChart'),{type:'line',data:{labels:d.labels,datasets:[{data:d.recovery,borderColor:'#8ef0c7',backgroundColor:'rgba(142,240,199,.12)',fill:true,tension:.35,pointRadius:0,spanGaps:true}]},options:{...baseOptions(),scales:{x:baseOptions().scales.x,y:{...baseOptions().scales.y,min:40,max:100}}}})}
  if(document.getElementById('sleepChart')&&!charts.sleep){charts.sleep=new Chart(document.getElementById('sleepChart'),{type:'bar',data:{labels:d.labels,datasets:[{data:d.sleepHours,backgroundColor:'rgba(122,184,255,.72)',borderRadius:6}]},options:{...baseOptions(),scales:{x:baseOptions().scales.x,y:{...baseOptions().scales.y,min:0,max:10}}}})}
  if(document.getElementById('stepsChart')&&!charts.steps){charts.steps=new Chart(document.getElementById('stepsChart'),{type:'bar',data:{labels:d.labels,datasets:[{data:d.steps,backgroundColor:'rgba(142,240,199,.58)',borderRadius:6}]},options:{...baseOptions(),scales:{x:baseOptions().scales.x,y:{...baseOptions().scales.y,beginAtZero:true}}}})}
  renderStrengthChart();
}

function minutesDisplay(total){total=Math.max(0,Math.round(Number(total)||0));const h=Math.floor(total/60),m=total%60;return h?`${h}h ${m?`${m}m`:''}`.trim():`${m}m`}
function pct(now,goal){return goal?Math.max(0,Math.min(100,Math.round((now/goal)*100))):0}
function signedPct(value,baseline){if(!value||!baseline)return'Baseline building';const diff=Math.round(((value-baseline)/baseline)*100);return`${diff>=0?'+':''}${diff}% vs baseline`}
function signedNumber(value,baseline,unit=''){if(!value||!baseline)return'Baseline building';const diff=Math.round(value-baseline);if(diff===0)return'At baseline';return`${Math.abs(diff)}${unit} ${diff<0?'lower':'higher'}`}
function getByPath(obj,path){return path.split('.').reduce((v,k)=>v?.[k],obj)}
function qualityLabel(score){if(score>=85)return'Very good';if(score>=70)return'Good';if(score>=55)return'Fair';return'Needs recovery'}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function localDateKey(d=new Date()){return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function startOfWeek(d=new Date()){const x=new Date(d);const day=(x.getDay()+6)%7;x.setHours(0,0,0,0);x.setDate(x.getDate()-day);return x}
function daysAgo(days){const d=new Date();d.setDate(d.getDate()-days);return d}
function numberFormat(v,max=0){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:max})}
function sum(a){return a.reduce((s,v)=>s+Number(v||0),0)}
function mean(a){const v=a.filter(Number.isFinite);return v.length?sum(v)/v.length:null}
function e1rm(weight,reps){weight=Number(weight)||0;reps=Number(reps)||0;return weight&&reps?weight*(1+reps/30):0}
function completedSets(exercise){return(exercise?.sets||[]).filter(s=>s.done&&Number(s.weight)>0&&Number(s.reps)>0)}
function exerciseVolume(exercise){return sum(completedSets(exercise).map(s=>Number(s.weight)*Number(s.reps)))}
function workoutStats(workout){const sets=(workout.exercises||[]).flatMap(completedSets);const volume=sum(sets.map(s=>Number(s.weight)*Number(s.reps)));return{sets:sets.length,volume,duration:Math.max(1,Math.round((new Date(workout.endedAt||Date.now())-new Date(workout.startedAt))/60000))}}
function weekWorkouts(offset=0){const start=startOfWeek();start.setDate(start.getDate()-offset*7);const end=new Date(start);end.setDate(end.getDate()+7);return getWorkouts().filter(w=>{const t=new Date(w.startedAt);return t>=start&&t<end})}
function workoutsSince(days){const cutoff=daysAgo(days);return getWorkouts().filter(w=>new Date(w.startedAt)>=cutoff)}
function allExerciseHistory(name){return getWorkouts().flatMap(w=>(w.exercises||[]).filter(e=>e.name===name).map(e=>({workout:w,exercise:e,sets:completedSets(e)}))).filter(x=>x.sets.length).sort((a,b)=>new Date(a.workout.startedAt)-new Date(b.workout.startedAt))}
function bestE1rmFromExercise(e){return Math.max(0,...completedSets(e).map(s=>e1rm(s.weight,s.reps)))}
function previousExerciseSession(name,before=Date.now()){return allExerciseHistory(name).filter(x=>new Date(x.workout.startedAt).getTime()<before).at(-1)||null}
function bestHistoricalE1rm(name,before=Date.now()){return Math.max(0,...allExerciseHistory(name).filter(x=>new Date(x.workout.startedAt).getTime()<before).map(x=>bestE1rmFromExercise(x.exercise)))}
function findExercise(name){return EXERCISES.find(e=>e.name===name)||{id:`custom-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,name,muscle:'Other'}}

function hydrate(data){
  liveData=data;
  const goals=getGoals();
  const shaped={...data,recovery:{...data.recovery,sleepDisplay:minutesDisplay(data.recovery.sleepMinutes),hrvDisplay:data.recovery.hrvMs?`${Math.round(data.recovery.hrvMs)} ms`:'—',rhrDisplay:data.recovery.restingHr?`${Math.round(data.recovery.restingHr)} bpm`:'—'},today:{...data.today,stepGoal:goals.stepGoal,activeZoneGoal:goals.activeZoneGoal,stepsFormatted:Number(data.today.steps||0).toLocaleString(),caloriesFormatted:Number(data.today.calories||0).toLocaleString(),azmDisplay:`${Math.round(data.today.activeZoneMinutes||0)} min`,floorsDisplay:data.today.floors==null?'—':String(Math.round(data.today.floors))}};
  document.querySelectorAll('[data-bind]').forEach(el=>{const v=getByPath(shaped,el.dataset.bind);if(v!==undefined&&v!==null)el.textContent=v});
  const score=data.recovery.score||0;const ring=document.querySelector('#recoveryRing .ring-progress');if(ring)ring.setAttribute('stroke-dasharray',`${score} 100`);document.getElementById('recoveryRing')?.setAttribute('aria-label',`Recovery score ${score}`);
  document.getElementById('recoveryHeadline').textContent=score>=80?'Good day to train':score>=65?'Train normally':'Prioritize recovery';
  document.getElementById('recoverySummary').textContent=score>=80?'Your overnight signals are favorable relative to your 30-day baseline.':score>=65?'Your signals are near baseline. Normal training should be reasonable.':'Sleep or cardiovascular recovery signals are below your recent baseline.';
  document.getElementById('sleepDelta').textContent=data.recovery.sleepBaseline?signedNumber(data.recovery.sleepMinutes,data.recovery.sleepBaseline,' min'):'Baseline building';
  document.getElementById('hrvDelta').textContent=signedPct(data.recovery.hrvMs,data.recovery.hrvBaseline);
  document.getElementById('rhrDelta').textContent=signedNumber(data.recovery.restingHr,data.recovery.restingHrBaseline,' bpm');
  document.getElementById('sleepQuality').textContent=qualityLabel(data.recovery.pulseSleepScore);
  const sp=pct(data.today.steps,goals.stepGoal),ap=pct(data.today.activeZoneMinutes,goals.activeZoneGoal);
  document.getElementById('stepsPct').textContent=`${sp}%`;document.getElementById('stepsProgress').style.width=`${sp}%`;document.getElementById('stepsGoal').textContent=`Goal: ${goals.stepGoal.toLocaleString()}`;
  document.getElementById('azmPct').textContent=`${ap}%`;document.getElementById('azmProgress').style.width=`${ap}%`;document.getElementById('azmGoal').textContent=`Goal: ${goals.activeZoneGoal} min`;
  document.getElementById('activityStepGoal').textContent=`of ${goals.stepGoal.toLocaleString()}`;document.getElementById('activityStepsPct').textContent=`${sp}%`;document.getElementById('stepRing').style.background=`radial-gradient(circle at center,var(--surface) 56%,transparent 57%),conic-gradient(var(--accent) ${sp}%,rgba(255,255,255,.07) 0)`;
  document.getElementById('activityAzmGoal').textContent=`Goal ${goals.activeZoneGoal} min`;document.getElementById('activityDistance').textContent=`${Number(data.today.distanceMiles||0).toFixed(1)} mi`;document.getElementById('floorsUnit').textContent=data.today.floors==null?'not tracked':'floors';
  const stepAvg=mean((data.trends?.last7||[]).map(x=>Number(x.steps)).filter(Number.isFinite));document.getElementById('activityStepAverage').textContent=stepAvg?Math.round(stepAvg).toLocaleString():'—';
  hydrateRecovery(data);hydrateSleep(data);renderTraining();renderWeeklySnapshot();renderTodayInsight();initCharts(true);
}

function hydrateRecovery(data){
  const r=data.recovery||{};const score=r.score||0;
  document.getElementById('recoveryPanelTitle').textContent=score>=80?'Above your baseline':score>=65?'Near your baseline':'Below your baseline';
  document.getElementById('recoveryPanelText').textContent=score>=80?'Your overnight signals support normal or harder training.':score>=65?'Your recovery signals are mixed but close to normal.':'A lighter day may fit your current recovery signals better.';
  document.getElementById('recoveryHrvDetail').textContent=`${r.hrvMs||'—'} ms · ${signedPct(r.hrvMs,r.hrvBaseline)}`;
  document.getElementById('recoveryRhrDetail').textContent=`${r.restingHr||'—'} bpm · ${signedNumber(r.restingHr,r.restingHrBaseline)}`;
  document.getElementById('recoveryConsistencyDetail').textContent=r.bedtimeVariabilityMinutes!=null?`Bedtime variability ±${r.bedtimeVariabilityMinutes} min`:'Building 30-day pattern';
  const sleepDelta=r.sleepBaseline?Math.round(r.sleepMinutes-r.sleepBaseline):0;document.getElementById('factorSleep').textContent=r.sleepBaseline?`${sleepDelta>=0?'+':''}${sleepDelta}m`:'—';
  const hrvDelta=r.hrvBaseline?Math.round(((r.hrvMs-r.hrvBaseline)/r.hrvBaseline)*100):null;document.getElementById('factorHrv').textContent=hrvDelta==null?'—':`${hrvDelta>=0?'+':''}${hrvDelta}%`;
  const rhrDelta=r.restingHrBaseline?Math.round(r.restingHr-r.restingHrBaseline):null;document.getElementById('factorRhr').textContent=rhrDelta==null?'—':`${rhrDelta>0?'+':''}${rhrDelta} bpm`;
  document.getElementById('factorConsistency').textContent=r.sleepConsistencyScore!=null?`${r.sleepConsistencyScore}%`:'—';
  const loads=combinedLoads();document.getElementById('factorLoad').textContent=loads.load7>loads.weeklyBaseline*1.3?'High':loads.load7>loads.weeklyBaseline*.75?'Normal':'Light';document.getElementById('recoveryLoadDetail').textContent=`${Math.round(loads.load7)} Pulse Load · 7 days`;
}

function hydrateSleep(data){
  const s=data.sleep;const r=data.recovery||{};
  if(!s){document.getElementById('sleepWindow').textContent='No sleep session returned by Google Health.';return}
  document.getElementById('sleepWindow').textContent=`${new Date(s.startTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} – ${new Date(s.endTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · ${minutesDisplay(s.minutesAsleep)} asleep`;
  const stages=s.stages||{};const total=Object.values(stages).reduce((a,b)=>a+Number(b||0),0)||1;Object.entries(stages).forEach(([key,val])=>{const ve=document.querySelector(`[data-stage-value="${key}"]`),bar=document.querySelector(`[data-stage="${key}"] .stage-bar i`);if(ve)ve.textContent=minutesDisplay(val);if(bar)bar.style.width=`${Math.round(Number(val||0)/total*100)}%`});
  document.getElementById('sleepEfficiency').textContent=s.efficiency!=null?`${s.efficiency}%`:'—';document.getElementById('sleepConsistency').textContent=r.sleepConsistencyScore!=null?`${r.sleepConsistencyScore}%`:'—';document.getElementById('sleepConsistencyMeta').textContent=r.bedtimeVariabilityMinutes!=null?`Bedtime ±${r.bedtimeVariabilityMinutes}m`:'Building baseline';document.getElementById('sleepBaselineMetric').textContent=r.sleepBaseline?minutesDisplay(r.sleepBaseline):'—';
  const debt=r.sleepBaseline?Math.round(s.minutesAsleep-r.sleepBaseline):null;document.getElementById('sleepDebt').textContent=debt==null?'—':`${debt>=0?'+':''}${minutesDisplay(Math.abs(debt))}`;document.getElementById('sleepHeadline').textContent=s.score>=85?'Restorative night':s.score>=70?'Solid night':s.score>=55?'Mixed night':'Short on recovery';document.getElementById('sleepSummary').textContent=r.sleepBaseline?`You slept ${Math.abs(debt)} minutes ${debt>=0?'above':'below'} your rolling 30-day duration baseline.`:'Pulse is building your personal sleep baseline.';document.getElementById('sleepStatusChip').textContent=qualityLabel(s.score);
}

function renderWeeklySnapshot(){
  const goals=getGoals(),week=weekWorkouts(),stats=week.map(workoutStats),sets=sum(stats.map(x=>x.sets)),volume=sum(stats.map(x=>x.volume));document.getElementById('weekWorkouts').textContent=`${week.length}/${goals.workoutsPerWeek}`;document.getElementById('weekVolume').textContent=`${numberFormat(volume)} lb`;document.getElementById('weekSets').textContent=`${sets} working sets`;
  const l7=liveData?.trends?.last7||[];const sl=mean(l7.map(x=>x.sleepMinutes).filter(Number.isFinite));const rec=mean(l7.map(x=>x.recovery).filter(Number.isFinite));document.getElementById('weekSleep').textContent=sl?minutesDisplay(sl):'—';document.getElementById('weekRecovery').textContent=rec?Math.round(rec):'—';
  const streak=calculateStreak(goals.workoutsPerWeek);document.getElementById('weekStreak').textContent=`${streak} week streak`;
}

function calculateStreak(goal){let streak=0;for(let i=0;i<12;i++){if(weekWorkouts(i).length>=goal)streak++;else if(i===0&&weekWorkouts(i).length<goal)continue;else break}return streak}
function localWorkoutLoad(w){const s=workoutStats(w);return s.duration*.45+s.sets*2.5+s.volume/1200}
function overlapsGoogle(local,google){const ls=new Date(local.startedAt).getTime(),le=new Date(local.endedAt||local.startedAt).getTime(),gs=new Date(google.startTime).getTime(),ge=new Date(google.endTime||google.startTime).getTime();return Math.max(ls,gs)<=Math.min(le+15*60000,ge+15*60000)}
function combinedLoads(){
  const locals7=workoutsSince(7),locals28=workoutsSince(28);const google=liveData?.training?.workouts||[];const cardioLoad=(days,locals)=>google.filter(g=>new Date(g.startTime)>=daysAgo(days)&&!locals.some(l=>overlapsGoogle(l,g))).reduce((s,g)=>s+Number(g.minutes||0),0);const load7=sum(locals7.map(localWorkoutLoad))+cardioLoad(7,locals7);const load28=sum(locals28.map(localWorkoutLoad))+cardioLoad(28,locals28);return{load7,load28,weeklyBaseline:load28/4||load7||1,ratio:load28?load7/(load28/4):null}}

function renderTraining(){
  renderTemplates();renderLoad();renderGoals();renderMuscles();renderAnalytics();renderCorrelation();renderStrengthHistory();renderGoogleWorkouts();renderProgressionSuggestion();renderWeeklySnapshot();renderTodayTrainingSuggestion();renderStrengthChart(true);
}
function renderTemplates(){const box=document.getElementById('templateGrid');if(!box)return;box.innerHTML=getTemplates().map(t=>`<button class="template-card" data-template="${escapeHtml(t.id)}"><div><div class="template-top"><h3>${escapeHtml(t.name)}</h3><span class="template-count">${t.exercises.length} exercises</span></div><p>${escapeHtml(t.description||t.exercises.slice(0,3).join(' · '))}</p></div><span class="template-start">Start →</span></button>`).join('');box.querySelectorAll('[data-template]').forEach(b=>b.addEventListener('click',()=>startWorkoutFromTemplate(b.dataset.template)))}
function renderLoad(){const l=combinedLoads();const ratio=l.ratio;document.getElementById('load7').textContent=Math.round(l.load7);document.getElementById('load28').textContent=Math.round(l.load28);document.getElementById('loadRatio').textContent=ratio?ratio.toFixed(2):'—';document.getElementById('load7Meta').textContent='strength + non-overlap cardio';document.getElementById('load28Meta').textContent='rolling 28-day load';document.getElementById('loadRatioMeta').textContent=!ratio?'building baseline':ratio>1.5?'well above recent average':ratio>1.15?'above recent average':ratio<.65?'below recent average':'near recent average'}
function renderGoals(){const g=getGoals(),w=weekWorkouts(),sets=sum(w.map(x=>workoutStats(x).sets)),streak=calculateStreak(g.workoutsPerWeek);document.getElementById('goalWorkoutsText').textContent=`${w.length} / ${g.workoutsPerWeek}`;document.getElementById('goalSetsText').textContent=`${sets} / ${g.workingSetsPerWeek}`;document.getElementById('goalWorkoutsBar').style.width=`${pct(w.length,g.workoutsPerWeek)}%`;document.getElementById('goalSetsBar').style.width=`${pct(sets,g.workingSetsPerWeek)}%`;document.getElementById('trainingStreak').textContent=`${streak} week streak`;document.getElementById('streakMeta').textContent=streak?`You have met your workout goal for ${streak} completed week${streak===1?'':'s'}.`:'Hit your workout goal to start a streak.'}
function renderMuscles(){const sets={};weekWorkouts().forEach(w=>(w.exercises||[]).forEach(e=>{sets[e.muscle||'Other']=(sets[e.muscle||'Other']||0)+completedSets(e).length}));const ordered=Object.entries(sets).sort((a,b)=>b[1]-a[1]);const box=document.getElementById('muscleVolume');if(!ordered.length){box.innerHTML='<div class="workout-row"><div class="workout-icon">—</div><div><h3>No strength sets this week</h3><p>Muscle-group volume will appear after your first logged workout.</p></div></div>';return}const max=Math.max(...ordered.map(x=>x[1]),1);box.innerHTML=ordered.map(([m,c])=>`<div class="muscle-row"><span>${escapeHtml(m)}</span><div class="muscle-bar"><i style="width:${Math.round(c/max*100)}%"></i></div><strong>${c}</strong></div>`).join('')}
function renderAnalytics(){const week=weekWorkouts(),prev=weekWorkouts(1),weekVol=sum(week.map(w=>workoutStats(w).volume)),prevVol=sum(prev.map(w=>workoutStats(w).volume));document.getElementById('analyticsVolume').textContent=`${numberFormat(weekVol)} lb`;document.getElementById('analyticsVolumeDelta').textContent=prevVol?`${weekVol>=prevVol?'+':''}${Math.round((weekVol-prevVol)/prevVol*100)}% vs last week`:'Start logging to compare';const month=workoutsSince(30),prs=month.flatMap(w=>w.prs||[]).length;document.getElementById('analyticsPrs').textContent=prs;const durations=month.map(w=>workoutStats(w).duration);document.getElementById('analyticsDuration').textContent=durations.length?minutesDisplay(mean(durations)):'—';const improv=mostImprovedExercise();document.getElementById('analyticsTopExercise').textContent=improv?.name||'—';document.getElementById('analyticsTopExerciseMeta').textContent=improv?`${improv.change>=0?'+':''}${improv.change.toFixed(1)}% est. 1RM`:'most improved'}
function mostImprovedExercise(){const names=[...new Set(getWorkouts().flatMap(w=>(w.exercises||[]).map(e=>e.name)))];let best=null;for(const name of names){const h=allExerciseHistory(name);if(h.length<2)continue;const first=bestE1rmFromExercise(h[0].exercise),last=bestE1rmFromExercise(h.at(-1).exercise);if(!first||!last)continue;const change=(last-first)/first*100;if(!best||change>best.change)best={name,change}}return best}
function renderStrengthHistory(){const box=document.getElementById('strengthHistory'),ws=[...getWorkouts()].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt)).slice(0,8);if(!ws.length){box.innerHTML='<article class="workout-row"><div class="workout-icon">＋</div><div><h3>No strength sessions yet</h3><p>Start Push, Pull, Legs or a custom routine.</p></div></article>';return}box.innerHTML=ws.map(w=>{const s=workoutStats(w);return`<article class="workout-row clickable" data-workout-id="${escapeHtml(w.id)}"><div class="workout-icon">${escapeHtml(w.name.charAt(0).toUpperCase())}</div><div><h3>${escapeHtml(w.name)}</h3><p>${new Date(w.startedAt).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${minutesDisplay(s.duration)} · ${s.sets} sets</p></div><div class="right"><strong>${numberFormat(s.volume)}</strong><span>lb volume</span></div></article>`}).join('');box.querySelectorAll('[data-workout-id]').forEach(row=>row.addEventListener('click',()=>openWorkoutDetail(row.dataset.workoutId)))}
function renderGoogleWorkouts(){const box=document.getElementById('googleWorkoutList'),ws=liveData?.training?.workouts?.slice(0,8)||[];if(!ws.length){box.innerHTML='<article class="workout-row"><div class="workout-icon">—</div><div><h3>No Fitbit exercise sessions</h3><p>Sync Google Health to show detected workouts.</p></div></article>';return}box.innerHTML=ws.map(w=>{const metric=w.calories?`${Math.round(w.calories)}<span>kcal</span>`:w.distanceMiles?`${w.distanceMiles.toFixed(1)}<span>mi</span>`:`${w.minutes}<span>min</span>`;return`<article class="workout-row"><div class="workout-icon">${escapeHtml(w.name.charAt(0))}</div><div><h3>${escapeHtml(w.name)}</h3><p>${new Date(w.startTime).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${minutesDisplay(w.minutes)}</p></div><div class="right"><strong>${metric}</strong></div></article>`}).join('')}
function renderStrengthChart(force=false){if(!window.Chart)return;const canvas=document.getElementById('strengthChart');if(!canvas)return;if(force)destroyChart('strength');if(charts.strength)return;const ws=[...getWorkouts()].sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt)).slice(-10);charts.strength=new Chart(canvas,{type:'line',data:{labels:ws.map(w=>new Date(w.startedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})),datasets:[{data:ws.map(w=>Math.round(workoutStats(w).volume)),borderColor:'#7ab8ff',backgroundColor:'rgba(122,184,255,.12)',fill:true,tension:.35,pointRadius:3}]},options:{...baseOptions(),scales:{x:baseOptions().scales.x,y:{...baseOptions().scales.y,beginAtZero:true}}}})}

function progressionFor(name){const h=allExerciseHistory(name);if(!h.length)return null;const last=h.at(-1),sets=last.sets,best=sets.reduce((a,b)=>e1rm(b.weight,b.reps)>e1rm(a.weight,a.reps)?b:a,sets[0]);const weight=Number(best.weight),reps=Number(best.reps);if(reps>=10)return{name,text:`You hit ${weight} × ${reps}. Try ${weight+5} lb for 6–8 reps next time.`,weight:weight+5,reps:7};if(reps>=6)return{name,text:`Repeat ${weight} lb and aim for ${reps+1} reps before adding weight.`,weight,reps:reps+1};return{name,text:`Stay near ${weight} lb and build back toward 6–8 clean reps.`,weight,reps:Math.max(6,reps)}}
function renderProgressionSuggestion(){const workouts=[...getWorkouts()].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt));let suggestion=null;for(const w of workouts){for(const e of w.exercises||[]){suggestion=progressionFor(e.name);if(suggestion)break}if(suggestion)break}const box=document.getElementById('progressionSuggestion');if(!suggestion){box.innerHTML='<div class="suggestion-icon">↗</div><div><h3>Log your first session</h3><p>Pulse will prefill your previous sets and suggest progressive overload.</p></div>';return}box.innerHTML=`<div class="suggestion-icon">↗</div><div><h3>${escapeHtml(suggestion.name)}</h3><p>${escapeHtml(suggestion.text)}</p></div>`}
function renderTodayTrainingSuggestion(){const s=document.getElementById('todayTrainingSuggestion'),title=document.getElementById('todayTrainingTitle');const score=liveData?.recovery?.score;const latest=[...getWorkouts()].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0];if(score!=null){title.textContent=score>=80?'Recovery supports a solid session':score>=65?'Normal training looks reasonable':'Consider a lighter session';}if(latest){const first=latest.exercises?.[0]?.name;const p=first?progressionFor(first):null;s.textContent=p?p.text:`Last session: ${latest.name}. Pulse will prefill your previous working sets.`}else s.textContent='Choose Push, Pull, Legs or create a routine. Pulse will learn your progression from each session.'}

function renderCorrelation(){const observations=[];for(const w of getWorkouts()){if(!Number.isFinite(Number(w.recoveryScore)))continue;for(const e of w.exercises||[]){const best=bestE1rmFromExercise(e);if(best)observations.push({name:e.name,recovery:Number(w.recoveryScore),performance:best})}}const groups={};observations.forEach(o=>(groups[o.name]??=[]).push(o));let best=null;for(const [name,rows] of Object.entries(groups)){if(rows.length<4)continue;const high=rows.filter(r=>r.recovery>=75),low=rows.filter(r=>r.recovery<75);if(high.length<2||low.length<2)continue;const hi=mean(high.map(r=>r.performance)),lo=mean(low.map(r=>r.performance));const diff=(hi-lo)/lo*100;if(!best||Math.abs(diff)>Math.abs(best.diff))best={name,diff,hi,lo}}const title=document.getElementById('correlationTitle'),text=document.getElementById('correlationText');if(!best){title.textContent='Building your correlation';text.textContent='Complete at least four sessions of the same exercise across different recovery days. Pulse will compare estimated strength performance.';return}title.textContent=`${best.name} vs recovery`;text.textContent=best.diff>=0?`Your estimated ${best.name} strength has averaged ${Math.abs(best.diff).toFixed(1)}% higher on Recovery 75+ days in your logged sessions.`:`So far, ${best.name} performance has not been higher on Recovery 75+ days. Keep logging—this is an observation, not a causal conclusion.`}
function renderTodayInsight(){const title=document.getElementById('todayInsightTitle'),text=document.getElementById('todayInsightText'),obs=getWorkouts().length;if(obs<4){title.textContent='Building your performance pattern';text.textContent=`${obs} strength session${obs===1?'':'s'} logged. A few more sessions will unlock recovery × lifting insights.`;return}const l=combinedLoads();title.textContent=l.ratio&&l.ratio>1.3?'Training load is elevated':'Training load is in context';text.textContent=l.ratio?`Your 7-day Pulse Load is ${l.ratio.toFixed(2)}× your 28-day weekly average. Use recovery and soreness alongside this trend.`:'Pulse is building a 28-day training-load baseline.'}

function initialSetsForExercise(name){const prev=previousExerciseSession(name);if(prev){return prev.sets.slice(0,4).map(s=>({weight:Number(s.weight)||'',reps:Number(s.reps)||'',rpe:s.rpe||'',done:false,completedAt:null}))}return Array.from({length:3},()=>({weight:'',reps:'',rpe:'',done:false,completedAt:null}))}
function startWorkoutFromTemplate(id){const t=getTemplates().find(x=>x.id===id);if(!t)return;activeWorkout={id:`w-${Date.now()}`,templateId:t.id,name:t.name,startedAt:new Date().toISOString(),recoveryScore:liveData?.recovery?.score??null,exercises:t.exercises.map(name=>{const ex=findExercise(name);return{id:`ae-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:ex.name,muscle:ex.muscle,sets:initialSetsForExercise(ex.name)}})};writeJson(STORAGE.active,activeWorkout);openWorkoutModal()}
function startQuickWorkout(){if(activeWorkout){openWorkoutModal();return}const last=[...getWorkouts()].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0];if(last?.templateId&&getTemplates().some(t=>t.id===last.templateId))startWorkoutFromTemplate(last.templateId);else startWorkoutFromTemplate('push')}
function openWorkoutModal(){document.getElementById('workoutModal').hidden=false;document.body.classList.add('sheet-open');document.getElementById('workoutModalTitle').textContent=activeWorkout.name;renderActiveWorkout();startWorkoutClock()}
function closeWorkoutModal(){if(activeWorkout&&completedSetCount(activeWorkout)>0&&!confirm('Keep this workout in progress and close the logger?'))return;document.getElementById('workoutModal').hidden=true;document.body.classList.remove('sheet-open');clearInterval(workoutTicker);workoutTicker=null}
function startWorkoutClock(){clearInterval(workoutTicker);const tick=()=>{if(!activeWorkout)return;const sec=Math.max(0,Math.floor((Date.now()-new Date(activeWorkout.startedAt).getTime())/1000));document.getElementById('workoutElapsed').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`};tick();workoutTicker=setInterval(tick,1000)}
function completedSetCount(w){return sum((w.exercises||[]).map(e=>completedSets(e).length))}
function persistActive(){if(activeWorkout)writeJson(STORAGE.active,activeWorkout)}
function renderActiveWorkout(){const box=document.getElementById('activeWorkoutExercises');box.innerHTML=activeWorkout.exercises.map((e,ei)=>{const prev=previousExerciseSession(e.name,new Date(activeWorkout.startedAt).getTime());const prog=progressionFor(e.name);return`<article class="exercise-card" data-exercise-index="${ei}"><div class="exercise-card-head"><div><h3>${escapeHtml(e.name)}</h3><p>${escapeHtml(e.muscle)}${prev?` · Previous ${prev.sets.map(s=>`${s.weight}×${s.reps}`).join(', ')}`:''}</p></div><button data-remove-exercise="${ei}" aria-label="Remove exercise">×</button></div>${prog?`<div class="progression-note">${escapeHtml(prog.text)}</div>`:''}<div class="set-table"><div class="set-header"><span>SET</span><span>LB</span><span>REPS</span><span>RPE</span><span>DONE</span></div>${e.sets.map((s,si)=>`<div class="set-row ${s.done?'done':''}" data-set-row="${ei}-${si}"><span class="set-index">${si+1}</span><input inputmode="decimal" type="number" min="0" step="2.5" value="${escapeHtml(s.weight)}" data-set-field="weight" data-ei="${ei}" data-si="${si}" placeholder="${prev?.sets?.[si]?.weight||'—'}"><input inputmode="numeric" type="number" min="1" max="50" value="${escapeHtml(s.reps)}" data-set-field="reps" data-ei="${ei}" data-si="${si}" placeholder="${prev?.sets?.[si]?.reps||'—'}"><input inputmode="decimal" type="number" min="1" max="10" step=".5" value="${escapeHtml(s.rpe)}" data-set-field="rpe" data-ei="${ei}" data-si="${si}" placeholder="—"><button class="set-done" data-done-set="${ei}-${si}">${s.done?'✓':'○'}</button></div>`).join('')}</div><button class="add-set" data-add-set="${ei}">+ Add set</button></article>`}).join('');
  box.querySelectorAll('[data-set-field]').forEach(inp=>inp.addEventListener('input',()=>{const e=activeWorkout.exercises[Number(inp.dataset.ei)],s=e.sets[Number(inp.dataset.si)];s[inp.dataset.setField]=inp.value;persistActive()}));
  box.querySelectorAll('[data-done-set]').forEach(btn=>btn.addEventListener('click',()=>toggleSetDone(btn.dataset.doneSet)));
  box.querySelectorAll('[data-add-set]').forEach(btn=>btn.addEventListener('click',()=>{const e=activeWorkout.exercises[Number(btn.dataset.addSet)],last=e.sets.at(-1);e.sets.push({weight:last?.weight||'',reps:last?.reps||'',rpe:last?.rpe||'',done:false,completedAt:null});persistActive();renderActiveWorkout()}));
  box.querySelectorAll('[data-remove-exercise]').forEach(btn=>btn.addEventListener('click',()=>{const i=Number(btn.dataset.removeExercise);if(confirm(`Remove ${activeWorkout.exercises[i].name} from this workout?`)){activeWorkout.exercises.splice(i,1);persistActive();renderActiveWorkout()}}));
}
function toggleSetDone(key){const[ei,si]=key.split('-').map(Number),s=activeWorkout.exercises[ei].sets[si];if(!s.done&&(!(Number(s.weight)>0)||!(Number(s.reps)>0))){alert('Enter weight and reps before completing the set.');return}s.done=!s.done;s.completedAt=s.done?new Date().toISOString():null;persistActive();if(s.done)startRestTimer(90);renderActiveWorkout()}
function startRestTimer(seconds){clearInterval(restTicker);restEndsAt=Date.now()+seconds*1000;const banner=document.getElementById('restBanner');banner.hidden=false;const tick=()=>{const left=Math.max(0,Math.ceil((restEndsAt-Date.now())/1000));document.getElementById('restTimer').textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;if(left<=0){clearInterval(restTicker);restTicker=null;banner.hidden=true}};tick();restTicker=setInterval(tick,250)}
function skipRest(){clearInterval(restTicker);restTicker=null;document.getElementById('restBanner').hidden=true}

function finishWorkout(){if(!activeWorkout)return;const completed=completedSetCount(activeWorkout);if(!completed){alert('Complete at least one set before finishing the workout.');return}activeWorkout.endedAt=new Date().toISOString();activeWorkout.exercises=activeWorkout.exercises.map(e=>({...e,sets:e.sets.filter(s=>s.done)})).filter(e=>e.sets.length);const prs=[];for(const e of activeWorkout.exercises){const prevBest=bestHistoricalE1rm(e.name,new Date(activeWorkout.startedAt).getTime());const nowBest=bestE1rmFromExercise(e);if(nowBest>0&&(!prevBest||nowBest>prevBest*1.005))prs.push({exercise:e.name,e1rm:Math.round(nowBest),previous:Math.round(prevBest)})}activeWorkout.prs=prs;const completedWorkout=JSON.parse(JSON.stringify(activeWorkout));const ws=getWorkouts();ws.push(completedWorkout);saveWorkouts(ws);localStorage.removeItem(STORAGE.active);activeWorkout=null;clearInterval(workoutTicker);skipRest();document.getElementById('workoutModal').hidden=true;showCompletion(completedWorkout);renderTraining();renderWeeklySnapshot();renderTodayInsight()}
function showCompletion(w){const s=workoutStats(w);document.getElementById('completionTitle').textContent=w.name;document.getElementById('completionDuration').textContent=minutesDisplay(s.duration);document.getElementById('completionSets').textContent=s.sets;document.getElementById('completionVolume').textContent=`${numberFormat(s.volume)} lb`;document.getElementById('completionPrs').textContent=w.prs?.length||0;document.getElementById('completionMessage').textContent=w.prs?.length?`${w.prs.map(p=>`${p.exercise}: est. 1RM ${p.e1rm} lb`).join(' · ')}`:'Session saved. Pulse will use these sets for your next-session prefill and progression suggestions.';document.getElementById('completionSheet').hidden=false;document.body.classList.add('sheet-open')}
function closeCompletion(){document.getElementById('completionSheet').hidden=true;document.body.classList.remove('sheet-open')}

function openExercisePicker(){document.getElementById('exercisePicker').hidden=false;document.getElementById('exerciseSearch').value='';renderExercisePicker('')}
function closeExercisePicker(){document.getElementById('exercisePicker').hidden=true}
function renderExercisePicker(query=''){const q=query.trim().toLowerCase(),box=document.getElementById('exercisePickerList');const rows=EXERCISES.filter(e=>!q||e.name.toLowerCase().includes(q)||e.muscle.toLowerCase().includes(q));box.innerHTML=rows.map(e=>`<button class="exercise-picker-item" data-exercise-name="${escapeHtml(e.name)}"><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(e.muscle)}</span></button>`).join('');box.querySelectorAll('[data-exercise-name]').forEach(b=>b.addEventListener('click',()=>addExerciseToActive(b.dataset.exerciseName)))}
function addExerciseToActive(name,muscle=null){if(!activeWorkout)return;const ex=muscle?{name,muscle}:findExercise(name);activeWorkout.exercises.push({id:`ae-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:ex.name,muscle:ex.muscle,sets:initialSetsForExercise(ex.name)});persistActive();closeExercisePicker();renderActiveWorkout()}
function createCustomExercise(){const name=prompt('Exercise name');if(!name)return;const muscle=prompt('Primary muscle group (e.g. Chest, Back, Quads)','Other')||'Other';addExerciseToActive(name.trim(),muscle.trim())}


function matchedGoogleWorkout(w){
  const candidates=liveData?.training?.workouts||[];
  return candidates.find(g=>overlapsGoogle(w,g))||null;
}
function hrStatsForWindow(points,startMs,endMs){
  const vals=points.filter(p=>{const t=new Date(p.time).getTime();return t>=startMs&&t<=endMs}).map(p=>Number(p.bpm)).filter(Number.isFinite);
  return vals.length?{avg:Math.round(mean(vals)),max:Math.max(...vals)}:null;
}
async function openWorkoutDetail(id){
  const w=getWorkouts().find(x=>x.id===id);if(!w)return;
  const stats=workoutStats(w),sheet=document.getElementById('workoutDetailSheet');
  document.getElementById('workoutDetailTitle').textContent=w.name;
  document.getElementById('workoutDetailSummary').innerHTML=`<div><span>Duration</span><strong>${minutesDisplay(stats.duration)}</strong></div><div><span>Sets</span><strong>${stats.sets}</strong></div><div><span>Volume</span><strong>${numberFormat(stats.volume)}</strong></div><div><span>Recovery</span><strong>${w.recoveryScore??'—'}</strong></div>`;
  const context=document.getElementById('fitbitContext'),matched=matchedGoogleWorkout(w);
  context.innerHTML=matched?`<strong>Fitbit context</strong><p>${matched.avgHr?`Avg HR ${matched.avgHr} bpm · `:''}${matched.calories?`${Math.round(matched.calories)} kcal · `:''}${matched.activeZoneMinutes?`${Math.round(matched.activeZoneMinutes)} zone min`:''}</p>`:'<strong>Fitbit context</strong><p>No overlapping Google Health exercise session found yet. Fitbit may sync it later.</p>';
  const exBox=document.getElementById('workoutDetailExercises');
  exBox.innerHTML=(w.exercises||[]).map((e,ei)=>`<article class="detail-exercise"><h3>${escapeHtml(e.name)}</h3>${completedSets(e).map((set,si)=>`<div class="detail-set-row" data-detail-set="${ei}-${si}"><span>Set ${si+1}</span><strong>${set.weight} lb</strong><strong>${set.reps} reps</strong><strong class="hr-chip">HR —</strong></div>`).join('')}</article>`).join('');
  sheet.hidden=false;document.body.classList.add('sheet-open');
  if(healthConnected&&w.startedAt&&w.endedAt){
    try{
      const r=await fetch(`/api/heart-rate?start=${encodeURIComponent(w.startedAt)}&end=${encodeURIComponent(w.endedAt)}`,{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'HR unavailable');const points=data.points||[];
      (w.exercises||[]).forEach((e,ei)=>completedSets(e).forEach((set,si)=>{const done=new Date(set.completedAt||w.startedAt).getTime();const hr=hrStatsForWindow(points,done-60000,done+10000);const el=document.querySelector(`[data-detail-set="${ei}-${si}"] .hr-chip`);if(el)el.textContent=hr?`HR ${hr.avg}/${hr.max}`:'HR —'}));
      if(points.length){const overall=hrStatsForWindow(points,new Date(w.startedAt).getTime(),new Date(w.endedAt).getTime());if(overall&&!matched)context.innerHTML=`<strong>Fitbit heart rate</strong><p>Session telemetry avg ${overall.avg} bpm · max ${overall.max} bpm. Per-set HR uses the minute around each set completion.</p>`;else if(overall)context.querySelector('p').textContent+=` · HR telemetry max ${overall.max} bpm. Per-set values use the minute around set completion.`}
    }catch(e){context.querySelector('p').textContent+=` Heart-rate detail unavailable: ${e.message}`}
  }
}
function closeWorkoutDetail(){document.getElementById('workoutDetailSheet').hidden=true;document.body.classList.remove('sheet-open')}
function createRoutine(){const name=prompt('Routine name (for example Upper A)');if(!name)return;const exerciseText=prompt('Enter exercises separated by commas. You can use names like Bench Press, Barbell Row, Back Squat.');if(!exerciseText)return;const exercises=exerciseText.split(',').map(x=>x.trim()).filter(Boolean);if(!exercises.length)return;const custom=getCustomTemplates();custom.push({id:`custom-${Date.now()}`,name:name.trim(),description:exercises.slice(0,3).join(' · '),exercises});saveCustomTemplates(custom);renderTemplates()}
function editGoals(){const g=getGoals();const workouts=Number(prompt('Strength workouts per week',g.workoutsPerWeek));if(!Number.isFinite(workouts)||workouts<1)return;const sets=Number(prompt('Working sets per week',g.workingSetsPerWeek));if(!Number.isFinite(sets)||sets<1)return;const steps=Number(prompt('Daily step goal',g.stepGoal));if(!Number.isFinite(steps)||steps<1000)return;const azm=Number(prompt('Daily Active Zone Minutes goal',g.activeZoneGoal));if(!Number.isFinite(azm)||azm<1)return;saveGoals({workoutsPerWeek:Math.round(workouts),workingSetsPerWeek:Math.round(sets),stepGoal:Math.round(steps),activeZoneGoal:Math.round(azm)});if(liveData)hydrate(liveData);else renderTraining()}
function exportTraining(){const payload={exportedAt:new Date().toISOString(),goals:getGoals(),customTemplates:getCustomTemplates(),workouts:getWorkouts()};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`pulse-training-${localDateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function loadStatus(){const card=document.getElementById('connectionCard'),button=document.getElementById('connectButton'),title=document.getElementById('connectionTitle'),subtitle=document.getElementById('connectionSubtitle');try{const status=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());if(!status.configured){healthConnected=false;title.textContent='Demo data';subtitle.textContent=status.deployment==='vercel'?'Add Google OAuth environment variables in Vercel.':'Add Google Health OAuth credentials to enable live Fitbit Air data.';button.textContent='Setup';button.onclick=()=>alert('Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET in Vercel, then redeploy.');updateSettingsState();return}if(status.connected){healthConnected=true;card.classList.add('connected');title.textContent='Fitbit Air connected';subtitle.textContent='Syncing from Google Health…';button.textContent='Sync';button.onclick=loadDashboard;await loadDashboard()}else{healthConnected=false;card.classList.remove('connected');title.textContent=oauthError?'Google Health connection failed':'Google Health ready';subtitle.textContent=oauthError?decodeURIComponent(oauthError):'Connect once to load your Fitbit Air health history.';button.textContent='Connect';button.onclick=()=>{window.location.href='/api/auth/google'};if(oauthError)subtitle.classList.add('sync-error')}updateSettingsState()}catch{healthConnected=false;title.textContent='Static demo';subtitle.textContent='The API is unavailable. Pulse training logging still works locally.';button.textContent='Demo';button.disabled=true;updateSettingsState()}}
async function loadDashboard(){const button=document.getElementById('connectButton'),subtitle=document.getElementById('connectionSubtitle');button.disabled=true;button.textContent='Syncing';try{const r=await fetch(`/api/dashboard?date=${todayKey}`,{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not sync Google Health');hydrate(data);subtitle.classList.remove('sync-error');subtitle.textContent=`Google Health · synced ${new Date(data.syncedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;button.textContent='Sync'}catch(e){subtitle.classList.add('sync-error');subtitle.textContent=e.message;button.textContent='Retry'}finally{button.disabled=false}}

function isStandalone(){return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true}
async function installPulse(){if(isStandalone())return;if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice.catch(()=>null);deferredInstallPrompt=null;document.getElementById('installButton').hidden=true;updateSettingsState();return}alert('In Chrome on Android, open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.')}
function setSheet(open){document.getElementById('settingsSheet').hidden=!open;document.body.classList.toggle('sheet-open',open)}
function updateSettingsState(){const install=document.getElementById('settingsInstall'),sync=document.getElementById('settingsSync'),disconnect=document.getElementById('settingsDisconnect');if(!install||!sync||!disconnect)return;install.disabled=isStandalone();install.querySelector('strong').textContent=isStandalone()?'Pulse installed':'Install Pulse';install.querySelector('small').textContent=isStandalone()?'Running as an installed app':'Add it to your phone home screen';sync.disabled=!healthConnected;disconnect.disabled=!healthConnected}
async function disconnectGoogleHealth(){if(!healthConnected)return;if(!confirm('Disconnect Google Health from Pulse on this device?'))return;try{await fetch('/api/logout',{method:'POST',cache:'no-store'})}finally{window.location.replace('/')}}

window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;if(!isStandalone())document.getElementById('installButton').hidden=false;updateSettingsState()});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;document.getElementById('installButton').hidden=true;updateSettingsState()});
document.getElementById('installButton').addEventListener('click',installPulse);document.getElementById('settingsButton').addEventListener('click',()=>{updateSettingsState();setSheet(true)});document.getElementById('settingsClose').addEventListener('click',()=>setSheet(false));document.getElementById('settingsBackdrop').addEventListener('click',()=>setSheet(false));document.getElementById('settingsInstall').addEventListener('click',installPulse);document.getElementById('settingsSync').addEventListener('click',async()=>{setSheet(false);await loadDashboard()});document.getElementById('settingsGoals').addEventListener('click',()=>{setSheet(false);editGoals()});document.getElementById('settingsExport').addEventListener('click',exportTraining);document.getElementById('settingsDisconnect').addEventListener('click',disconnectGoogleHealth);
document.getElementById('startWorkoutButton').addEventListener('click',startQuickWorkout);document.getElementById('todayStartWorkout').addEventListener('click',startQuickWorkout);document.getElementById('newRoutineButton').addEventListener('click',createRoutine);document.getElementById('editGoalsButton').addEventListener('click',editGoals);
document.getElementById('workoutClose').addEventListener('click',closeWorkoutModal);document.getElementById('finishWorkoutButton').addEventListener('click',finishWorkout);document.getElementById('skipRestButton').addEventListener('click',skipRest);document.getElementById('addExerciseButton').addEventListener('click',openExercisePicker);document.getElementById('exercisePickerClose').addEventListener('click',closeExercisePicker);document.getElementById('exercisePickerBackdrop').addEventListener('click',closeExercisePicker);document.getElementById('exerciseSearch').addEventListener('input',e=>renderExercisePicker(e.target.value));document.getElementById('customExerciseButton').addEventListener('click',createCustomExercise);document.getElementById('completionBackdrop').addEventListener('click',closeCompletion);document.getElementById('completionDone').addEventListener('click',closeCompletion);document.getElementById('workoutDetailBackdrop').addEventListener('click',closeWorkoutDetail);document.getElementById('workoutDetailClose').addEventListener('click',closeWorkoutDetail);

if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
if(oauthError)history.replaceState({},'','/');
const savedActive=readJson(STORAGE.active,null);if(savedActive){activeWorkout=savedActive;document.getElementById('todayTrainingTitle').textContent='Workout in progress';document.getElementById('todayTrainingSuggestion').textContent=`Resume ${activeWorkout.name} and keep your logged sets.`;document.getElementById('todayStartWorkout').textContent='Resume';}
initCharts();renderTraining();loadStatus();updateSettingsState();
