'use strict';
/* Anchor — a small, offline, one-thing-at-a-time planner.
   All data lives in this device's localStorage. Nothing is sent anywhere. */

const KEY = 'anchor.v1';
const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const z = (n) => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const mkey = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}`;
const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = (k) => Math.round((parseDay(k) - parseDay(dkey())) / 864e5);

/* ---------- state ---------- */

const CATS = [['delivery', 'Food delivery'], ['groceries', 'Groceries'], ['eatout', 'Eating out'], ['transport', 'Transport'], ['fun', 'Fun/games'], ['shopping', 'Shopping'], ['uni', 'Study'], ['other', 'Other']];

function seed() {
  return {
    v: 1,
    settings: { name: '', bedtime: '23:30', weeklyBudget: 150, currency: '$' },
    tasks: [],
    spends: [],
    bills: [],
    deadlines: [],
    promises: [],
    habits: [
      { id: 'meal', name: 'Ate a proper meal' },
      { id: 'move', name: 'Moved for 10+ minutes' },
      { id: 'water', name: 'Drank water' },
      { id: 'bed', name: 'Phone away at bedtime' },
    ],
    habitLog: {},
    shutdown: {},
    urges: [],
    focus: [],
    timer: null,
  };
}

/* Coerce loaded/imported data into the expected shape so a malformed or
   tampered backup file can't inject markup through ids, numbers or dates. */
const URGE_KINDS = { food: 1, snack: 1, scroll: 1, game: 1, late: 1, buy: 1 };
const ID = /^[\w-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max = 500) => String(v ?? '').slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const id = (v) => (ID.test(String(v)) ? String(v) : uid());
const day = (v) => (DAY.test(String(v)) ? String(v) : '');
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function normalize(d) {
  const base = seed();
  d = obj(d);
  const st = obj(d.settings);
  const bools = (o) => Object.fromEntries(Object.entries(obj(o)).filter(([k]) => ID.test(k)).map(([k, v]) => [k, !!v]));
  return {
    v: 1,
    settings: {
      name: str(st.name, 60),
      bedtime: /^\d{2}:\d{2}$/.test(st.bedtime) ? st.bedtime : base.settings.bedtime,
      weeklyBudget: num(st.weeklyBudget ?? base.settings.weeklyBudget),
      currency: str(st.currency ?? '$', 3),
    },
    tasks: arr(d.tasks).map((t) => ({ id: id(t.id), title: str(t.title), step: str(t.step), list: ['today', 'later', 'inbox'].includes(t.list) ? t.list : 'inbox', done: !!t.done, doneAt: t.doneAt ? num(t.doneAt) : null, created: num(t.created) || Date.now() })),
    spends: arr(d.spends).map((x) => ({ id: id(x.id), amt: num(x.amt), cat: CATS.some((c) => c[0] === x.cat) ? x.cat : 'other', note: str(x.note), ts: num(x.ts) })),
    bills: arr(d.bills).map((b) => ({ id: id(b.id), name: str(b.name), amt: num(b.amt), day: Math.min(31, Math.max(1, Math.round(num(b.day)) || 1)), paid: bools(b.paid) })),
    deadlines: arr(d.deadlines).map((x) => ({ id: id(x.id), title: str(x.title), course: str(x.course), due: day(x.due) || dkey(), progress: Math.min(100, Math.max(0, num(x.progress))), next: str(x.next), done: !!x.done })),
    promises: arr(d.promises).map((p) => ({ id: id(p.id), who: str(p.who), what: str(p.what), by: day(p.by), done: !!p.done })),
    habits: Array.isArray(d.habits) ? arr(d.habits).map((h) => ({ id: id(h.id), name: str(h.name) })) : base.habits,
    habitLog: Object.fromEntries(Object.entries(obj(d.habitLog)).filter(([k]) => DAY.test(k)).map(([k, v]) => [k, bools(v)])),
    shutdown: Object.fromEntries(Object.entries(obj(d.shutdown)).filter(([k]) => DAY.test(k)).map(([k, v]) => [k, bools(v)])),
    urges: arr(d.urges).map((u) => ({ ts: num(u.ts), kind: str(u.kind, 20), outcome: u.outcome === 'resisted' ? 'resisted' : 'gave' })),
    focus: arr(d.focus).map((f) => ({ ts: num(f.ts), mins: num(f.mins) })),
    timer: normTimer(d.timer),
  };
}

function normTimer(t) {
  if (!t || typeof t !== 'object' || !num(t.end) || !num(t.mins)) return null;
  return { start: num(t.start), end: num(t.end), mins: num(t.mins), label: str(t.label), kind: t.kind === 'urge' ? 'urge' : 'focus', taskId: ID.test(String(t.taskId)) ? String(t.taskId) : null, beeped: !!t.beeped, urge: Object.hasOwn(URGE_KINDS, t.urge) ? t.urge : undefined };
}

/* ---------- storage & optional app lock ----------
   Without a passcode, data is saved as JSON in this device's localStorage.
   With a passcode, it is encrypted on the device (AES-256-GCM, key derived
   from the passcode with PBKDF2) before every write. The key only exists in
   memory while the app is unlocked and is never written anywhere. */

const LOCK = { key: null, salt: null, locked: false, hiddenAt: 0, fails: 0 };
const AUTO_LOCK_MS = 60 * 1000;
const KDF_ITERATIONS = 600000;
const te = new TextEncoder();
const td = new TextDecoder();
const cryptoOk = !!(window.crypto && crypto.subtle && window.isSecureContext);
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const isSealed = (d) => !!(d && d.anchorEncrypted === 1 && typeof d.ct === 'string' && typeof d.iv === 'string' && typeof d.salt === 'string');

async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(json, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(json)));
  return { anchorEncrypted: 1, kdf: `PBKDF2-SHA256-${KDF_ITERATIONS}`, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function unseal(env, pass) {
  const salt = unb64(env.salt);
  const key = await deriveKey(pass, salt);
  // Throws if the passcode is wrong (GCM authentication fails).
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
  return { data: JSON.parse(td.decode(pt)), key, salt };
}

let S = null;
(() => {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch {}
  try {
    const d = raw ? JSON.parse(raw) : null;
    if (isSealed(d)) LOCK.locked = true;
    else S = d ? normalize(d) : seed();
  } catch {
    // Unreadable data: keep a copy rather than silently overwriting it.
    try { localStorage.setItem(`${KEY}.unreadable`, raw); } catch {}
    S = seed();
  }
})();

let writeQueue = Promise.resolve();
const store = (str) => { try { localStorage.setItem(KEY, str); } catch { /* storage full or blocked */ } };
function save() {
  if (!S) return;
  const { key, salt } = LOCK;
  const json = JSON.stringify(S);
  // Writes are queued so an older write can never land after a newer one.
  writeQueue = writeQueue.then(async () => store(key ? JSON.stringify(await seal(json, key, salt)) : json)).catch(() => {});
}

function lockNow() {
  if (!LOCK.key) return;
  S = null; LOCK.key = null; LOCK.locked = true;
  ui.sheet = null; ui.draftFor = null; ui.pendingImport = null;
  render();
}

async function unlock(pass) {
  await writeQueue;
  let env = null;
  try { env = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!isSealed(env)) { S = env ? normalize(env) : seed(); LOCK.locked = false; return true; }
  try {
    const r = await unseal(env, pass);
    S = normalize(r.data); LOCK.key = r.key; LOCK.salt = r.salt; LOCK.locked = false; LOCK.fails = 0;
    return true;
  } catch { LOCK.fails++; return false; }
}

function wipe() {
  try { localStorage.removeItem(KEY); } catch {}
  LOCK.key = null; LOCK.salt = null; LOCK.locked = false; LOCK.fails = 0;
  S = seed();
}

const ui = { tab: 'now', sheet: null, draftFor: null, showDone: false, pendingImport: null };
try { ui.tab = sessionStorage.getItem('anchor.tab') || 'now'; } catch {}
if (!['now', 'plan', 'money', 'due', 'me'].includes(ui.tab)) ui.tab = 'now';

const money = (n) => `${esc(S.settings.currency)}${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '')}`;

/* ---------- time helpers ---------- */

function weekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
const thisWeek = (arr) => { const ws = weekStart().getTime(); return arr.filter((x) => x.ts >= ws); };

function bedtimeInfo() {
  const [h, m] = (S.settings.bedtime || '23:30').split(':').map(Number);
  const now = new Date();
  const bed = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  // Treat 00:00–05:00 as "still last night" so staying up past midnight reads as late.
  if (now.getHours() < 5) bed.setDate(bed.getDate() - (h < 12 ? 0 : 1));
  else if (h < 12) bed.setDate(bed.getDate() + 1);
  const mins = Math.round((bed - now) / 60000);
  return { mins, late: mins < 0, soon: mins >= 0 && mins <= 90 };
}
const fmtMins = (m) => { m = Math.abs(m); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

/* ---------- views ---------- */

function header() {
  const d = new Date();
  const b = bedtimeInfo();
  const bedTxt = b.late ? `${fmtMins(b.mins)} past bedtime` : `Bedtime in ${fmtMins(b.mins)}`;
  return `<div><div class="date">${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</div>
    <div class="clock">${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div>
    <div class="bed ${b.late ? 'late' : ''}">${bedTxt}</div>`;
}

function timerCard() {
  const t = S.timer;
  if (!t) return '';
  const left = Math.max(0, t.end - Date.now());
  const frac = left / (t.mins * 60000);
  const ended = left === 0;
  const C = 2 * Math.PI * 42;
  return `<div class="card hero timer ${ended ? 'ended' : ''}" id="timerCard">
    <div class="ring"><svg width="96" height="96"><circle cx="48" cy="48" r="42" fill="none" stroke="var(--line)" stroke-width="8"/>
      <circle id="ringArc" cx="48" cy="48" r="42" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
      <div class="txt" id="timerTxt">${ended ? 'Done' : fmtClock(left)}</div></div>
    <div class="grow"><div class="label">${t.kind === 'urge' ? 'Urge pause' : 'Focus'}</div>
      <div class="t" style="font-weight:600;margin:2px 0 8px">${esc(t.label)}</div>
      <div class="row wrap">
        ${ended ? `<button class="primary sm" data-act="timer-finish">Finish</button>` : `<button class="sm" data-act="timer-add">+5 min</button>`}
        <button class="sm ghost" data-act="timer-stop">Stop</button>
      </div></div></div>`;
}
const fmtClock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${z(s % 60)}`; };

function viewNow() {
  const today = S.tasks.filter((t) => t.list === 'today' && !t.done);
  const one = today[0];
  const b = bedtimeInfo();
  let h = installHint() + timerCard();

  if (b.late || b.soon) h += shutdownCard(b);

  if (one) {
    h += `<div class="card hero"><div class="label">Right now, just this</div>
      <div class="title">${esc(one.title)}</div>
      ${one.step ? `<div class="step"><b>First tiny step:</b> ${esc(one.step)}</div>` : `<div class="step"><b>Feels too big?</b> Tap “Shrink it” and write the smallest physical action.</div>`}
      <div class="row wrap" style="margin-top:10px">
        ${S.timer?.taskId === one.id ? '' : `<button class="primary grow" data-act="focus" data-id="${one.id}" data-mins="10">Start 10 min</button>`}
        <button class="grow" data-act="task-done" data-id="${one.id}">Done ✓</button>
      </div>
      <div class="row wrap" style="margin-top:6px">
        <button class="sm ghost grow" data-act="task-step" data-id="${one.id}">Shrink it</button>
        <button class="sm ghost grow" data-act="task-skip" data-id="${one.id}">Do next one first</button>
      </div>
      <small>You don’t have to finish. You only have to start. ${today.length > 1 ? `${today.length - 1} more today.` : ''}</small></div>`;
  } else {
    h += `<div class="card hero"><div class="label">Right now</div>
      <div class="title">Nothing picked for today.</div>
      <p class="muted">Choose 1–3 things. Small is fine.</p>
      <button class="primary big" data-act="tab" data-id="plan">Pick today’s things</button></div>`;
  }

  h += `<button class="urge" data-act="urge-open">⚠︎ <b>I’m about to…</b> order food / scroll / game / stay up<br><small>Tap before you do it. 10-minute pause, no judgement.</small></button>`;

  h += `<form class="card" data-form="capture"><div class="row"><input name="t" placeholder="Brain dump: task, worry, idea…" autocomplete="off" enterkeyhint="done"><button class="primary">Add</button></div>
    <small>Goes to the Plan inbox so you can forget it for now.</small></form>`;

  h += alerts();

  const log = S.habitLog[dkey()] || {};
  h += `<h2>Today’s basics</h2><div class="chips">${S.habits.map((x) =>
    `<button class="chip ${log[x.id] ? 'on' : ''}" data-act="habit" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>`;
  return h;
}

function installHint() {
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let hidden = false;
  try { hidden = localStorage.getItem('anchor.hideInstall') === '1'; } catch {}
  if (standalone || hidden) return '';
  return `<div class="card warn"><b>Install this app</b><br><small>In Safari tap <b>Share → Add to Home Screen</b>, then always open it from that icon.
    In an ordinary browser tab, iOS may clear the app’s data after about a week of not using it.</small>
    <div class="row" style="margin-top:8px"><button class="sm" data-act="hide-install">Got it</button></div></div>`;
}

function alerts() {
  const out = [];
  const dl = S.deadlines.filter((d) => !d.done).sort((a, b) => a.due.localeCompare(b.due));
  for (const d of dl) {
    const n = daysUntil(d.due);
    if (n > 7) break;
    const cls = n <= 2 ? 'bad' : 'warn';
    out.push(`<div class="card ${cls}" data-act="tab" data-id="due"><div class="spread"><div class="t"><b>${esc(d.title)}</b></div><span class="pill ${cls}">${dueTxt(n)}</span></div>
      <small>${d.progress || 0}% done${d.next ? ` · next: ${esc(d.next)}` : ' · no next step yet'}</small></div>`);
  }
  const mk = mkey();
  const day = new Date().getDate();
  for (const b of S.bills) {
    if (b.paid?.[mk]) continue;
    const n = b.day - day;
    if (n <= 3) out.push(`<div class="card ${n < 0 ? 'bad' : 'warn'}" data-act="tab" data-id="money"><div class="spread"><b>Bill: ${esc(b.name)} ${b.amt ? money(b.amt) : ''}</b>
      <span class="pill ${n < 0 ? 'bad' : 'warn'}">${n < 0 ? `${-n}d overdue` : n === 0 ? 'due today' : `in ${n}d`}</span></div></div>`);
  }
  for (const p of S.promises) {
    if (p.done || !p.by) continue;
    const n = daysUntil(p.by);
    if (n <= 1) out.push(`<div class="card ${n < 0 ? 'bad' : 'warn'}" data-act="tab" data-id="due"><div class="spread"><b>Promised ${esc(p.who)}: ${esc(p.what)}</b>
      <span class="pill ${n < 0 ? 'bad' : 'warn'}">${dueTxt(n)}</span></div><small>If you can’t make it, tell them now — honestly. Tap for a message draft.</small></div>`);
  }
  const stale = S.tasks.filter((t) => !t.done && t.list === 'today' && Date.now() - t.created > 3 * 864e5);
  for (const t of stale.slice(0, 2)) {
    out.push(`<div class="card warn"><b>Avoiding:</b> ${esc(t.title)}<br><small>It’s been ${Math.floor((Date.now() - t.created) / 864e5)} days. Avoidance usually means the step is too big or unclear.</small>
      <div class="row" style="margin-top:8px"><button class="sm" data-act="task-step" data-id="${t.id}">Make the step smaller</button><button class="sm" data-act="task-top" data-id="${t.id}">Do it first</button></div></div>`);
  }
  return out.length ? `<h2>Needs attention</h2>${out.join('')}` : '';
}
const dueTxt = (n) => (n < 0 ? `${-n}d overdue` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${n} days`);

function shutdownCard(b) {
  const items = ['Tomorrow’s first task is picked', 'Alarm is set', 'Phone charging away from the bed', 'Lights/screens down'];
  const done = S.shutdown[dkey()] || {};
  const all = items.every((_, i) => done[i]);
  return `<div class="card ${b.late ? 'bad' : 'warn'}"><div class="spread"><b>${b.late ? 'Past bedtime. Tomorrow-you is paying for this.' : 'Wind-down time'}</b></div>
    <ul class="list">${items.map((t, i) => `<li class="${done[i] ? 'done' : ''}"><button class="check ${done[i] ? 'on' : ''}" data-act="shut" data-id="${i}" aria-label="toggle"></button><div class="t grow">${t}</div></li>`).join('')}</ul>
    ${all ? '<p><b>That’s it. Close the app. Goodnight.</b></p>' : ''}</div>`;
}

function taskLi(t, where) {
  return `<li class="${t.done ? 'done' : ''}">
    <button class="check ${t.done ? 'on' : ''}" data-act="${t.done ? 'task-undo' : 'task-done'}" data-id="${t.id}" aria-label="done"></button>
    <div class="grow"><div class="t">${esc(t.title)}</div>${t.step ? `<div class="s">→ ${esc(t.step)}</div>` : ''}</div>
    ${t.done ? '' : where === 'today'
      ? `<button class="icon" data-act="task-top" data-id="${t.id}" aria-label="move to top">↑</button><button class="icon" data-act="task-menu" data-id="${t.id}" aria-label="more">⋯</button>`
      : `<button class="sm" data-act="task-move" data-id="${t.id}" data-to="today">Today</button><button class="icon" data-act="task-menu" data-id="${t.id}" aria-label="more">⋯</button>`}
  </li>`;
}

function viewPlan() {
  const inbox = S.tasks.filter((t) => t.list === 'inbox' && !t.done);
  const today = S.tasks.filter((t) => t.list === 'today' && !t.done);
  const later = S.tasks.filter((t) => t.list === 'later' && !t.done);
  const doneToday = S.tasks.filter((t) => t.done && t.doneAt && dkey(new Date(t.doneAt)) === dkey());
  let h = '';
  if (inbox.length) {
    h += `<h2>Inbox — sort these (${inbox.length})</h2><div class="card"><ul class="list">${inbox.map((t) => `<li>
      <div class="grow t">${esc(t.title)}</div>
      <button class="sm" data-act="task-move" data-id="${t.id}" data-to="today">Today</button>
      <button class="sm" data-act="task-move" data-id="${t.id}" data-to="later">Later</button>
      <button class="icon" data-act="task-del" data-id="${t.id}" aria-label="delete">✕</button></li>`).join('')}</ul></div>`;
  }
  h += `<h2>Today ${today.length > 3 ? '<span class="pill warn">over 3 — move some to Later</span>' : ''}</h2>
    <div class="card">${today.length ? `<ul class="list">${today.map((t) => taskLi(t, 'today')).join('')}</ul>` : '<div class="empty">Nothing yet. Pick up to 3.</div>'}</div>`;
  if (doneToday.length) h += `<details class="card" ${ui.showDone ? 'open' : ''}><summary>Done today (${doneToday.length}) — that counts.</summary><ul class="list">${doneToday.map((t) => taskLi(t)).join('')}</ul></details>`;

  h += `<h2>Add a task</h2><form class="card" data-form="task">
    <input name="title" placeholder="What needs doing?" required autocomplete="off">
    <input name="step" placeholder="Smallest first step (e.g. “open the doc”)" autocomplete="off" style="margin-top:8px">
    <div class="chips"><label><input type="radio" name="list" value="today" checked><span>Today</span></label><label><input type="radio" name="list" value="later"><span>Later</span></label></div>
    <button class="primary big">Add</button></form>`;

  h += `<h2>Later (${later.length})</h2><div class="card">${later.length ? `<ul class="list">${later.map((t) => taskLi(t, 'later')).join('')}</ul>` : '<div class="empty">Empty.</div>'}</div>`;
  return h;
}

const catName = (c) => esc((CATS.find((x) => x[0] === c) || [c, c])[1]);

function viewMoney() {
  const wk = thisWeek(S.spends);
  const spent = wk.reduce((a, s) => a + s.amt, 0);
  const budget = Number(S.settings.weeklyBudget) || 0;
  const left = budget - spent;
  const daysLeft = 7 - ((new Date().getDay() + 6) % 7);
  const delivery = wk.filter((s) => s.cat === 'delivery').reduce((a, s) => a + s.amt, 0);
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;

  let h = `<div class="card hero"><div class="label">This week (Mon–Sun)</div>
    <div class="spread"><div><div class="big-num">${money(Math.max(0, left))}</div><small>${left < 0 ? `<b style="color:var(--bad)">${money(-left)} over budget</b>` : `left of ${money(budget)}`}</small></div>
    <div style="text-align:right"><b>${money(Math.max(0, left) / daysLeft)}</b><br><small>per day for ${daysLeft} day${daysLeft > 1 ? 's' : ''}</small></div></div>
    <div class="bar ${left < 0 ? 'over' : ''}"><i style="width:${pct}%"></i></div>
    <small>Food delivery this week: <b>${money(delivery)}</b></small></div>`;

  h += `<h2>Log spending (do it straight away)</h2><form class="card" data-form="spend">
    <div class="row"><input name="amt" inputmode="decimal" placeholder="Amount" required autocomplete="off" style="max-width:130px"><input name="note" placeholder="What (optional)" autocomplete="off"></div>
    <div class="chips">${CATS.map(([k, n], i) => `<label><input type="radio" name="cat" value="${k}" ${i === 0 ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    <button class="primary big">Log it</button></form>`;

  if (wk.length) {
    h += `<div class="card"><ul class="list">${wk.slice().reverse().map((s) => `<li><div class="grow"><div class="t">${money(s.amt)} · ${catName(s.cat)}</div>
      <div class="s">${new Date(s.ts).toLocaleDateString(undefined, { weekday: 'short' })}${s.note ? ` · ${esc(s.note)}` : ''}</div></div>
      <button class="icon" data-act="spend-del" data-id="${s.id}" aria-label="delete">✕</button></li>`).join('')}</ul></div>`;
  }

  const mk = mkey();
  const day = new Date().getDate();
  const bills = S.bills.slice().sort((a, b) => a.day - b.day);
  h += `<h2>Monthly bills & subscriptions</h2><div class="card">${bills.length ? `<ul class="list">${bills.map((b) => {
    const paid = b.paid?.[mk];
    const n = b.day - day;
    return `<li class="${paid ? 'done' : ''}"><button class="check ${paid ? 'on' : ''}" data-act="bill-paid" data-id="${b.id}" aria-label="paid"></button>
      <div class="grow"><div class="t">${esc(b.name)} ${b.amt ? `· ${money(b.amt)}` : ''}</div><div class="s">Due on the ${b.day}${ord(b.day)}${paid ? ' · paid this month' : n < 0 ? ` · <b style="color:var(--bad)">${-n}d overdue</b>` : n === 0 ? ' · due today' : ` · in ${n}d`}</div></div>
      <button class="icon" data-act="bill-del" data-id="${b.id}" aria-label="delete">✕</button></li>`;
  }).join('')}</ul>` : '<div class="empty">Add rent, phone, subscriptions… anything that repeats.</div>'}
    <form data-form="bill" style="margin-top:10px"><div class="row"><input name="name" placeholder="Bill name" required autocomplete="off"><input name="amt" inputmode="decimal" placeholder="Amount" style="max-width:90px" autocomplete="off"><input name="day" inputmode="numeric" placeholder="Day" required style="max-width:64px" autocomplete="off"></div>
    <button class="sm" style="margin-top:8px">Add bill</button></form></div>`;

  h += `<details class="card"><summary>Money tricks that actually work</summary><ul class="tips">
    <li>Delete saved cards from delivery apps. Typing the card number is friction, and friction is your friend.</li>
    <li>Move delivery apps off the home screen (or delete them — you can reinstall in 30 seconds if you really need one).</li>
    <li>Set up a separate account for bills that your pay/allowance goes into first.</li>
    <li>Log every spend <i>immediately</i>. Later means never.</li></ul></details>`;
  return h;
}
const ord = (n) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

function viewDue() {
  const dl = S.deadlines.filter((d) => !d.done).sort((a, b) => a.due.localeCompare(b.due));
  let h = `<h2>Deadlines</h2><div class="card">${dl.length ? `<ul class="list">${dl.map((d) => {
    const n = daysUntil(d.due);
    const cls = n <= 2 ? 'bad' : n <= 7 ? 'warn' : '';
    return `<li><div class="grow"><div class="spread"><div class="t">${esc(d.title)}</div><span class="pill ${cls}">${dueTxt(n)}</span></div>
      <div class="s">${esc(d.course || '')} ${d.course ? '·' : ''} due ${parseDay(d.due).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
      <div class="bar"><i style="width:${d.progress || 0}%"></i></div>
      <div class="s">${d.progress || 0}% · <b>Next:</b> ${d.next ? esc(d.next) : '<i>not set — what’s the very next action?</i>'}</div>
      <div class="row wrap" style="margin-top:6px">
        <button class="sm" data-act="dl-prog" data-id="${d.id}" data-d="10">+10%</button>
        <button class="sm" data-act="dl-next" data-id="${d.id}">Set next step</button>
        <button class="sm" data-act="dl-task" data-id="${d.id}">Work on it today</button>
        <button class="sm" data-act="dl-done" data-id="${d.id}">Submitted ✓</button>
        <button class="icon" data-act="dl-del" data-id="${d.id}" aria-label="delete">✕</button>
      </div></div></li>`;
  }).join('')}</ul>` : '<div class="empty">No deadlines yet. Add every one you know about — even far-off ones.</div>'}</div>
  <form class="card" data-form="deadline"><input name="title" placeholder="Assignment / exam" required autocomplete="off">
    <div class="row" style="margin-top:8px"><input name="course" placeholder="Course" autocomplete="off"><input name="due" type="date" required></div>
    <button class="primary big" style="margin-top:8px">Add deadline</button></form>`;

  const pr = S.promises.filter((p) => !p.done).sort((a, b) => (a.by || '9').localeCompare(b.by || '9'));
  h += `<h2>Commitments</h2>
  <p class="muted" style="margin:0 4px 8px;font-size:14px">Things you’ve said you’ll do for someone, so they don’t slip. Running late? An early heads-up is always easier than a late apology.</p>
  <div class="card">${pr.length ? `<ul class="list">${pr.map((p) => {
    const n = p.by ? daysUntil(p.by) : null;
    return `<li><button class="check" data-act="pr-done" data-id="${p.id}" aria-label="done"></button><div class="grow">
      <div class="spread"><div class="t">${esc(p.what)}</div>${n !== null ? `<span class="pill ${n < 0 ? 'bad' : n <= 1 ? 'warn' : ''}">${dueTxt(n)}</span>` : ''}</div>
      <div class="s">for ${esc(p.who)}</div>
      ${ui.draftFor === p.id ? draftBox(p) : `<button class="sm" style="margin-top:6px" data-act="pr-draft" data-id="${p.id}">Running late? Draft a heads-up</button>`}
      </div><button class="icon" data-act="pr-del" data-id="${p.id}" aria-label="delete">✕</button></li>`;
  }).join('')}</ul>` : '<div class="empty">Nothing tracked.</div>'}</div>
  <form class="card" data-form="promise"><div class="row"><input name="who" placeholder="Who" required autocomplete="off" style="max-width:120px"><input name="what" placeholder="What I said I’d do" required autocomplete="off"></div>
    <label class="field">By when<input name="by" type="date"></label><button class="primary big">Add</button></form>`;
  return h;
}

function draftBox(p) {
  const msg = `Hi ${p.who}, I wanted to give you a heads up — I’m behind on ${p.what}. That’s on me. I can realistically have it done by [DAY]. Sorry for the delay, and thanks for your patience.`;
  return `<textarea id="draftTxt" style="margin-top:6px;min-height:150px">${esc(msg)}</textarea>
    <div class="row" style="margin-top:6px"><button class="sm primary" data-act="copy-draft">Copy</button><button class="sm ghost" data-act="pr-draft" data-id="">Close</button></div>
    <small>Replace [DAY] with a date you’re genuinely confident about, then add a couple of days of buffer.</small>`;
}

function viewMe() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return dkey(d); });
  const log = S.habitLog[dkey()] || {};
  let h = `<h2>Daily basics</h2><div class="card"><ul class="list">${S.habits.map((x) => `<li>
    <button class="check ${log[x.id] ? 'on' : ''}" data-act="habit" data-id="${x.id}" aria-label="toggle"></button>
    <div class="grow"><div class="t">${esc(x.name)}</div><div class="dots" title="last 7 days">${days.map((k) => `<i class="${S.habitLog[k]?.[x.id] ? 'on' : ''}"></i>`).join('')}</div></div>
    <button class="icon" data-act="habit-del" data-id="${x.id}" aria-label="remove">✕</button></li>`).join('')}</ul>
    <form data-form="habit" class="row" style="margin-top:8px"><input name="name" placeholder="Add a daily basic" required autocomplete="off"><button class="sm">Add</button></form></div>`;

  const ws = weekStart().getTime();
  const doneWk = S.tasks.filter((t) => t.done && t.doneAt >= ws).length;
  const focusWk = S.focus.filter((f) => f.ts >= ws).reduce((a, f) => a + f.mins, 0);
  const urgesWk = S.urges.filter((u) => u.ts >= ws);
  const resisted = urgesWk.filter((u) => u.outcome === 'resisted').length;
  h += `<h2>This week</h2><div class="stats">
    <div><b>${doneWk}</b><small>tasks done</small></div>
    <div><b>${focusWk}m</b><small>focused</small></div>
    <div><b>${resisted}/${urgesWk.length}</b><small>urges ridden out</small></div>
    <div><b>${money(thisWeek(S.spends).filter((s) => s.cat === 'delivery').reduce((a, s) => a + s.amt, 0))}</b><small>on food delivery</small></div></div>
    <p class="muted" style="font-size:14px;margin:8px 4px">Not a score. Just information so you can see patterns instead of guessing.</p>`;

  h += shutdownCard({ late: false }).replace('Wind-down time', 'Evening shutdown (any time)');

  h += `<h2>Settings</h2><form class="card" data-form="settings">
    <label class="field">Your name<input name="name" value="${esc(S.settings.name)}" autocomplete="off"></label>
    <label class="field">Bedtime target<input name="bedtime" type="time" value="${esc(S.settings.bedtime)}"></label>
    <div class="row"><label class="field grow">Weekly spending budget<input name="weeklyBudget" inputmode="decimal" value="${esc(S.settings.weeklyBudget)}"></label>
    <label class="field" style="max-width:90px">Currency<input name="currency" value="${esc(S.settings.currency)}" maxlength="3"></label></div>
    <button class="primary big">Save settings</button></form>
    <h2>Privacy &amp; app lock</h2><div class="card">
    <p style="font-size:14px">Everything stays on this device: no account, no server, no tracking. The app is blocked from contacting any other website.</p>
    ${!cryptoOk ? '<p class="muted" style="font-size:14px">App lock needs the app to be opened over https.</p>'
      : LOCK.key ? `<p style="font-size:14px"><b>App lock is on.</b> Your data is encrypted on this device and the app locks itself a minute after you leave it.</p>
        <div class="row wrap"><button class="primary" data-act="lock-now">Lock now</button><button class="ghost" data-act="lock-off">Turn off app lock</button></div>`
      : `<p class="muted" style="font-size:14px">App lock is off. Anyone who opens this app on your unlocked phone can read it. A passcode encrypts everything the app saves.</p>
        <button class="primary" data-act="lock-setup">Set a passcode</button>`}</div>
    <h2>Backup</h2><div class="card"><p class="muted" style="font-size:14px">Your data only exists on this device. Export a backup now and then, and pick <b>Save to Files</b>.
      ${LOCK.key ? 'Backups are encrypted with your passcode.' : '<b>Backups are not encrypted</b> while app lock is off.'} Never upload a backup anywhere public.</p>
    <div class="row wrap"><button data-act="export">Export backup</button><button data-act="import">Import backup</button><button class="danger ghost" data-act="reset">Erase everything</button></div></div>`;
  return h;
}

/* ---------- urge sheet ---------- */

const URGES = {
  food: { name: 'Order food', tips: ['Drink a full glass of water first. Thirst and boredom both feel like hunger.', 'Are you actually hungry, or bored/tired/avoiding something?', 'If hungry: what’s already here? Toast, eggs, noodles, cereal, fruit. Eat that first.', 'If you still want it after 10 minutes, fine — pick the cheapest option and log it in Money.'] },
  snack: { name: 'Snack / overeat', tips: ['Put the food on a plate and leave the packet in the kitchen.', 'Drink water, then wait out the timer.', 'Ask: what am I actually feeling right now?'] },
  scroll: { name: 'Scroll', tips: ['Put the phone face down, across the room, for these 10 minutes.', 'Do the first tiny step of your Right Now task instead — just the step.', 'If you scroll after, set a 10-minute timer first so it has an end.'] },
  game: { name: 'Play a game', tips: ['Games after the one important thing. Do its first tiny step now.', 'If you play, decide the stop time before you start and set an alarm.', 'Stand up, stretch, get water — break the autopilot.'] },
  late: { name: 'Stay up', tips: ['Plug the phone in away from your bed, right now.', 'Tomorrow will be harder to manage on less sleep — that’s the whole loop.', 'Anything still on your mind: brain-dump it into the app, then it’s safe to forget.'] },
  buy: { name: 'Buy something', tips: ['Screenshot it instead. If you still want it in 48 hours, reconsider then.', 'Check the Money tab: what’s left this week?'] },
};

function sheetHtml() {
  const s = ui.sheet;
  if (!s) return '';
  if (s.step === 'lock-setup') {
    return `<div class="panel"><h3>Set a passcode</h3>
      <p class="muted">Everything this app saves will be encrypted on this device. It locks itself a minute after you leave it.</p>
      <p><b>If you forget the passcode, your data can’t be recovered.</b> Export a backup first if you want a safety net. Use at least 6 characters; longer is stronger.</p>
      <form data-form="lockSetup" autocomplete="off">
        <input name="p1" type="password" autocomplete="new-password" placeholder="Passcode" required minlength="6">
        <input name="p2" type="password" autocomplete="new-password" placeholder="Type it again" required minlength="6" style="margin-top:8px">
        <button class="primary big" style="margin-top:10px">Turn on app lock</button></form>
      <button class="ghost big" data-act="sheet-close" style="margin-top:8px">Cancel</button></div>`;
  }
  if (s.step === 'import-pass') {
    return `<div class="panel"><h3>Encrypted backup</h3>
      <p class="muted">Enter the passcode that was set when this backup was made. Restoring replaces everything currently in the app.</p>
      <form data-form="importPass" autocomplete="off"><input name="pass" type="password" autocomplete="off" placeholder="Backup passcode" required>
        <button class="primary big" style="margin-top:10px">Restore</button></form>
      <button class="ghost big" data-act="sheet-close" style="margin-top:8px">Cancel</button></div>`;
  }
  if (s.step === 'pick') {
    return `<div class="panel"><h3>What’s the urge?</h3><p class="muted">Naming it is the first win. You’re allowed to do it after — just not on autopilot.</p>
      <div class="chips">${Object.entries(URGES).map(([k, u]) => `<button class="chip" data-act="urge-kind" data-id="${k}">${u.name}</button>`).join('')}</div>
      <button class="ghost big" data-act="sheet-close">Cancel</button></div>`;
  }
  const u = URGES[s.kind];
  return `<div class="panel"><h3>Pause: ${u.name}</h3><p class="muted">Urges peak and fade, usually within 10–15 minutes. The timer is running on the Now screen.</p>
    <ol class="tips">${u.tips.map((t) => `<li>${t}</li>`).join('')}</ol>
    <p><b>When the timer ends (or whenever), be honest:</b></p>
    <div class="row"><button class="primary grow" data-act="urge-result" data-id="resisted">Urge passed 💪</button><button class="grow" data-act="urge-result" data-id="gave">I did it anyway</button></div>
    <small>“Did it anyway” isn’t failure — it’s data. Logging it is what builds awareness.</small>
    <button class="ghost big" data-act="sheet-close" style="margin-top:8px">Hide (timer keeps going)</button></div>`;
}

/* ---------- render ---------- */

const VIEWS = { now: viewNow, plan: viewPlan, money: viewMoney, due: viewDue, me: viewMe };

function lockScreen() {
  return `<form class="card hero" data-form="unlock" autocomplete="off" style="margin-top:18vh">
      <div class="label">Locked</div><div class="title">Enter your passcode</div>
      <input name="pass" type="password" autocomplete="current-password" enterkeyhint="go" required>
      <p id="lockMsg" class="muted">Your data is encrypted on this device.</p>
      <button class="primary big">Unlock</button></form>
    <details class="card"><summary>Forgot it?</summary>
      <p class="muted">There’s no recovery. That’s what keeps it private. You can erase this app’s data and start again, then import a backup if you have one.</p>
      <button class="danger" data-act="reset-locked">Erase and start over</button></details>`;
}

function render() {
  document.body.classList.toggle('locked', LOCK.locked);
  if (LOCK.locked) {
    $('#top').innerHTML = '';
    $('#view').innerHTML = lockScreen();
    $('#sheet').innerHTML = ''; $('#sheet').hidden = true;
    return;
  }
  $('#top').innerHTML = header();
  $('#view').innerHTML = VIEWS[ui.tab]();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.id === ui.tab));
  const sh = $('#sheet');
  sh.innerHTML = sheetHtml();
  sh.hidden = !ui.sheet;
}

function setTab(t) {
  ui.tab = t;
  try { sessionStorage.setItem('anchor.tab', t); } catch {}
  render();
  window.scrollTo(0, 0);
}

/* ---------- timer ---------- */

let audioCtx;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.25, audioCtx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.3);
      o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.3);
    });
  } catch {}
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function startTimer(mins, label, kind = 'focus', taskId = null) {
  // Create/resume the audio context inside the tap so iOS allows the end beep.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
  S.timer = { start: Date.now(), end: Date.now() + mins * 60000, mins, label, kind, taskId, beeped: false };
  save();
}

function finishTimer() {
  const t = S.timer;
  if (!t) return;
  if (t.kind === 'focus') S.focus.push({ ts: Date.now(), mins: Math.round((Math.min(Date.now(), t.end) - t.start) / 60000) });
  S.timer = null;
  save();
}

function tick() {
  if (!S) return;
  const top = $('#top');
  if (top) top.innerHTML = header();
  const t = S.timer;
  if (!t) return;
  const left = Math.max(0, t.end - Date.now());
  const txt = $('#timerTxt');
  const arc = $('#ringArc');
  if (left === 0 && !t.beeped) {
    t.beeped = true; save(); beep();
    if (ui.tab === 'now') render();
    return;
  }
  if (txt && left > 0) {
    txt.textContent = fmtClock(left);
    const C = 2 * Math.PI * 42;
    arc.setAttribute('stroke-dashoffset', C * (1 - left / (t.mins * 60000)));
  }
}

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/* ---------- actions ---------- */

const task = (id) => S.tasks.find((t) => t.id === id);

const ACTIONS = {
  tab: (el) => setTab(el.dataset.id),
  'task-done': (el) => { const t = task(el.dataset.id); t.done = true; t.doneAt = Date.now(); if (S.timer?.taskId === t.id) finishTimer(); },
  'task-undo': (el) => { const t = task(el.dataset.id); t.done = false; t.doneAt = null; },
  'task-del': (el) => { S.tasks = S.tasks.filter((t) => t.id !== el.dataset.id); },
  'task-move': (el) => { const t = task(el.dataset.id); t.list = el.dataset.to; if (el.dataset.to === 'today') t.created = Date.now(); },
  'task-top': (el) => { const t = task(el.dataset.id); S.tasks = [t, ...S.tasks.filter((x) => x !== t)]; if (ui.tab !== 'now') setTab('now'); },
  'task-skip': (el) => { const t = task(el.dataset.id); S.tasks = [...S.tasks.filter((x) => x !== t), t]; },
  'task-step': (el) => {
    const t = task(el.dataset.id);
    const v = prompt('What is the smallest physical action to get started? (e.g. “open the laptop”, “find the email”)', t.step || '');
    if (v !== null) t.step = v.trim();
  },
  'task-menu': (el) => {
    const t = task(el.dataset.id);
    const c = prompt(`“${t.title}”\n\nType a number:\n1 = edit first step\n2 = rename\n3 = move to ${t.list === 'today' ? 'Later' : 'Today'}\n4 = delete`);
    if (c === '1') ACTIONS['task-step'](el);
    else if (c === '2') { const v = prompt('Rename task', t.title); if (v?.trim()) t.title = v.trim(); }
    else if (c === '3') t.list = t.list === 'today' ? 'later' : 'today';
    else if (c === '4' && confirm('Delete this task?')) S.tasks = S.tasks.filter((x) => x !== t);
  },
  focus: (el) => { const t = task(el.dataset.id); startTimer(Number(el.dataset.mins), t.title, 'focus', t.id); window.scrollTo(0, 0); },
  'timer-add': () => { S.timer.end += 5 * 60000; S.timer.mins += 5; },
  'timer-stop': () => finishTimer(),
  'timer-finish': () => {
    const t = S.timer; finishTimer();
    if (t.kind === 'urge') ui.sheet = { step: 'result', kind: t.urge };
    else if (t.taskId && task(t.taskId) && confirm('Nice. Is the task finished? (Cancel = not yet, and that’s fine)')) { const x = task(t.taskId); x.done = true; x.doneAt = Date.now(); }
  },
  'urge-open': () => { ui.sheet = { step: 'pick' }; },
  'urge-kind': (el) => {
    const k = el.dataset.id;
    ui.sheet = { step: 'pause', kind: k };
    if (!S.timer) { startTimer(10, `Wait out the urge: ${URGES[k].name.toLowerCase()}`, 'urge'); S.timer.urge = k; }
  },
  'urge-result': (el) => {
    const kind = ui.sheet.kind;
    S.urges.push({ ts: Date.now(), kind, outcome: el.dataset.id });
    if (S.timer?.kind === 'urge') S.timer = null;
    ui.sheet = null;
    if (el.dataset.id === 'gave' && (kind === 'food' || kind === 'buy')) {
      const v = prompt('Logged. How much did/will it cost? (leave blank to skip)');
      const amt = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
      if (amt > 0) S.spends.push({ id: uid(), amt, cat: kind === 'food' ? 'delivery' : 'shopping', note: '', ts: Date.now() });
    }
  },
  'sheet-close': () => { ui.sheet = null; ui.pendingImport = null; },
  habit: (el) => { const k = dkey(); S.habitLog[k] = S.habitLog[k] || {}; S.habitLog[k][el.dataset.id] = !S.habitLog[k][el.dataset.id]; },
  'habit-del': (el) => { if (confirm('Remove this daily basic?')) S.habits = S.habits.filter((h) => h.id !== el.dataset.id); },
  shut: (el) => { const k = dkey(); S.shutdown[k] = S.shutdown[k] || {}; S.shutdown[k][el.dataset.id] = !S.shutdown[k][el.dataset.id]; },
  'spend-del': (el) => { S.spends = S.spends.filter((s) => s.id !== el.dataset.id); },
  'bill-paid': (el) => { const b = S.bills.find((x) => x.id === el.dataset.id); const mk = mkey(); b.paid = b.paid || {}; b.paid[mk] = !b.paid[mk]; },
  'bill-del': (el) => { if (confirm('Delete this bill?')) S.bills = S.bills.filter((b) => b.id !== el.dataset.id); },
  'dl-prog': (el) => { const d = S.deadlines.find((x) => x.id === el.dataset.id); d.progress = Math.min(100, (d.progress || 0) + 10); },
  'dl-next': (el) => { const d = S.deadlines.find((x) => x.id === el.dataset.id); const v = prompt('Very next action (small and concrete):', d.next || ''); if (v !== null) d.next = v.trim(); },
  'dl-task': (el) => {
    const d = S.deadlines.find((x) => x.id === el.dataset.id);
    S.tasks.unshift({ id: uid(), title: `Work on: ${d.title}`, step: d.next || 'Open the assignment brief and read the first paragraph', list: 'today', done: false, created: Date.now() });
    setTab('now');
  },
  'dl-done': (el) => { const d = S.deadlines.find((x) => x.id === el.dataset.id); d.done = true; },
  'dl-del': (el) => { if (confirm('Delete this deadline?')) S.deadlines = S.deadlines.filter((d) => d.id !== el.dataset.id); },
  'pr-done': (el) => { S.promises.find((p) => p.id === el.dataset.id).done = true; },
  'pr-del': (el) => { S.promises = S.promises.filter((p) => p.id !== el.dataset.id); },
  'pr-draft': (el) => { ui.draftFor = el.dataset.id || null; },
  'copy-draft': (el) => {
    const v = $('#draftTxt').value;
    (navigator.clipboard?.writeText(v) || Promise.reject()).then(() => { el.textContent = 'Copied ✓'; }, () => { $('#draftTxt').select(); });
    return 'norender';
  },
  export: () => {
    // Built synchronously so the iOS share sheet still counts as a response to the tap.
    let str = JSON.stringify(S);
    if (LOCK.key) {
      str = localStorage.getItem(KEY);
      let ok = false;
      try { ok = isSealed(JSON.parse(str)); } catch {}
      if (!ok) { alert('Still encrypting, try again in a second.'); return 'norender'; }
    }
    const file = new File([str], `anchor-backup-${dkey()}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch((err) => { if (err.name !== 'AbortError') download(file); });
    } else download(file);
    return 'norender';
  },
  import: () => { $('#importFile').click(); return 'norender'; },
  reset: () => { if (confirm('Erase ALL data in this app? Export a backup first if unsure.') && confirm('Really erase everything? This also turns off app lock.')) wipe(); },
  'reset-locked': () => { if (confirm('Erase ALL data in this app? It can’t be undone.') && confirm('Really erase everything?')) wipe(); },
  'lock-setup': () => { ui.sheet = { step: 'lock-setup' }; },
  'lock-now': () => { lockNow(); return 'norender'; },
  'lock-off': () => { if (confirm('Turn off app lock? Your data will be stored unencrypted on this device.')) { LOCK.key = null; LOCK.salt = null; } },
  'hide-install': () => { try { localStorage.setItem('anchor.hideInstall', '1'); } catch {} },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.id === 'sheet' && !LOCK.locked) { ui.sheet = null; ui.pendingImport = null; render(); }
    return;
  }
  e.preventDefault();
  if (LOCK.locked && el.dataset.act !== 'reset-locked') return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (fn(el) === 'norender') return;
  save();
  if (el.dataset.act !== 'tab') render();
});

const FORMS = {
  capture: (f) => { if (f.t.trim()) S.tasks.push({ id: uid(), title: f.t.trim(), step: '', list: 'inbox', done: false, created: Date.now() }); },
  task: (f) => S.tasks.push({ id: uid(), title: f.title.trim(), step: f.step.trim(), list: f.list, done: false, created: Date.now() }),
  spend: (f) => {
    const amt = parseFloat(f.amt.replace(/[^0-9.]/g, ''));
    if (amt > 0) S.spends.push({ id: uid(), amt, cat: f.cat, note: f.note.trim(), ts: Date.now() });
  },
  bill: (f) => {
    const day = Math.min(31, Math.max(1, parseInt(f.day, 10) || 1));
    S.bills.push({ id: uid(), name: f.name.trim(), amt: parseFloat(f.amt.replace(/[^0-9.]/g, '')) || 0, day, paid: {} });
  },
  deadline: (f) => S.deadlines.push({ id: uid(), title: f.title.trim(), course: f.course.trim(), due: f.due, progress: 0, next: '', done: false }),
  promise: (f) => S.promises.push({ id: uid(), who: f.who.trim(), what: f.what.trim(), by: f.by, done: false }),
  habit: (f) => S.habits.push({ id: uid(), name: f.name.trim() }),
  settings: (f) => {
    S.settings = { ...S.settings, name: f.name.trim(), bedtime: f.bedtime || '23:30', weeklyBudget: parseFloat(f.weeklyBudget) || 0, currency: f.currency || '$' };
    alert('Saved.');
  },
  unlock: async (f, form) => {
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Checking…';
    if (await unlock(f.pass || '')) return;
    // Slow down repeated guesses.
    const wait = LOCK.fails >= 3 ? Math.min(60, 2 ** (LOCK.fails - 2)) : 0;
    $('#lockMsg').textContent = wait ? `Wrong passcode. Try again in ${wait}s.` : 'Wrong passcode.';
    form.pass.value = '';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Unlock'; }, wait * 1000);
    return 'norender';
  },
  lockSetup: async (f, form) => {
    if ((f.p1 || '').length < 6) { alert('Use at least 6 characters.'); return 'norender'; }
    if (f.p1 !== f.p2) { alert('Those didn’t match. Try again.'); form.reset(); return 'norender'; }
    form.querySelector('button').textContent = 'Encrypting…';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    LOCK.key = await deriveKey(f.p1, salt);
    LOCK.salt = salt;
    ui.sheet = null;
  },
  importPass: async (f, form) => {
    form.querySelector('button').textContent = 'Decrypting…';
    try {
      const { data } = await unseal(ui.pendingImport, f.pass || '');
      S = normalize(data);
      ui.pendingImport = null; ui.sheet = null;
    } catch {
      alert('That passcode doesn’t open this backup.');
      form.querySelector('button').textContent = 'Restore';
      form.pass.value = '';
      return 'norender';
    }
  },
};

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const name = form.dataset.form;
  if (LOCK.locked !== (name === 'unlock')) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if ((await FORMS[name](data, form)) === 'norender') return;
  save();
  render();
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (isSealed(data)) {
      if (!cryptoOk) throw new Error('no crypto');
      ui.pendingImport = data; ui.sheet = { step: 'import-pass' }; render();
    } else {
      if (!data || !Array.isArray(data.tasks) || !data.settings) throw new Error('bad');
      if (confirm('Replace everything in this app with this backup?')) { S = normalize(data); save(); render(); }
    }
  } catch { alert('That file doesn’t look like an Anchor backup.'); }
  e.target.value = '';
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    LOCK.hiddenAt = Date.now();
    // Hide contents from the app switcher preview when app lock is on.
    if (LOCK.key) document.body.classList.add('veil');
    return;
  }
  document.body.classList.remove('veil');
  if (LOCK.key && Date.now() - LOCK.hiddenAt > AUTO_LOCK_MS) lockNow();
  else render();
});

render();
setInterval(tick, 1000);

// Ask iOS not to evict this app's storage (granted automatically for home-screen apps).
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
