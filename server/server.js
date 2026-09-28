// Демо-сервер «Приёмка»: API + SQLite + push-уведомления. Сайт (docs/) лежит на GitHub Pages,
// а для локальной работы сервер раздаёт его сам. Наружу выходит через туннель ngrok (npm run tunnel).
// Запуск: npm start   ·   Сбросить демо-данные: npm run reset
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { db, seed, nowMsk, clockMs, addDays, getSetting, setSetting, hashPassword, checkPassword, DEMO_PASSWORD, STAFF_SEED, DRIVER_PHONES } = require('./db');
const push = require('./push');

if (process.argv.includes('--reset-only')) { seed(); console.log('Демо-данные пересозданы'); process.exit(0); }

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';
const DOCS = path.join(__dirname, '..', 'docs');
const SESSION_TTL = 12 * 60 * 60 * 1000;
const DEMO_SHOW_CODE = true; // в демо SMS-код показываем на экране; в продукте — только SMS
// С каких сайтов браузеру разрешено обращаться к API (CORS)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://bogdalleksss.github.io,http://localhost:4321,http://127.0.0.1:4321').split(',');

const ROLES = { owner: 'Руководитель', weigher: 'Весовщик', lab: 'Лаборант', accountant: 'Бухгалтер' };
const PERMS = {
  invite: ['owner', 'weigher'], next: ['owner', 'weigher'], arrive: ['owner', 'weigher'],
  weigh: ['owner', 'weigher'], lab: ['owner', 'weigher', 'lab'], tounload: ['owner', 'weigher'], finish: ['owner', 'weigher'],
  sdiz: ['owner', 'accountant'], setBase: ['owner'],
  userCreate: ['owner'], userUpdate: ['owner'], userResetPassword: ['owner'], reset: ['owner'],
  driverArrive: ['driver'], book: ['driver'],
};

// ---------- помощники ----------
const normPhone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); if (d.length === 10) d = '7' + d; return d; };
const phoneOk = (d) => /^7\d{10}$/.test(d);
const maskPhone = (p) => `+7 ••• ••• ${p.slice(-4, -2)}-${p.slice(-2)}`;
const plateText = (t) => `${t.plate[0]} ${t.plate.slice(1, 4)} ${t.plate.slice(4)}`;
const ru = (n, d = 2) => Number(n).toFixed(d).replace('.', ',');
const clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? `${h} ч ${r} мин` : `${r} мин`; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const base = () => getSetting('base', { wb: 7, sb: 1, wetAlert: 10 });
function zach(t) { // зачётный вес: минус сор сверх базиса, затем влага сверх базиса
  if (t.gross == null || t.tare == null || t.w == null || t.s == null) return null;
  const wb = t.base_wb ?? base().wb, sb = t.base_sb ?? base().sb;
  return (t.gross - t.tare) * (1 - Math.max(0, t.s - sb) / (100 - sb)) * (1 - Math.max(0, t.w - wb) / (100 - wb));
}

// ---------- сессии: токен в заголовке Authorization, в базе — только его хеш ----------
function newSession(data) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, kind, user_id, phone, expires_ms) VALUES (?, ?, ?, ?, ?)').run(sha(token), data.kind, data.userId ?? null, data.phone ?? null, Date.now() + SESSION_TTL);
  return token;
}
function sessionFromToken(token, kind) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
  if (!s || s.expires_ms < Date.now() || s.kind !== kind) return null;
  if (s.kind === 'staff') {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
    if (!u || !u.active) return null;
    return { kind: 'staff', token, user: u, role: u.role };
  }
  return { kind: 'driver', token, phone: s.phone, role: 'driver' };
}
const bearer = (req) => { const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ''); return m ? m[1] : null; };
const appKind = (req, url) => ((req.headers['x-app'] || url.searchParams.get('app')) === 'driver' ? 'driver' : 'staff');
const dropSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

// ---------- ограничение частоты ----------
const hits = new Map();
const recent = (k, w) => { const t = Date.now(), l = (hits.get(k) || []).filter((x) => t - x < w); hits.set(k, l); return l; };
const tooMany = (k, max, w) => recent(k, w).length >= max;
const hit = (k) => { const l = hits.get(k) || []; l.push(Date.now()); hits.set(k, l); };
const limited = (k, max, w) => { hit(k); return recent(k, w).length > max; };
const codes = new Map(); // SMS-коды водителей живут в памяти 5 минут

// ---------- журнал и события ----------
const who = (ctx) => (ctx.kind === 'staff' ? `${ctx.user.name} (${ROLES[ctx.role]})` : `Водитель ${maskPhone(ctx.phone)}`);
const audit = (ctx, text) => db.prepare('INSERT INTO audit(at_ms, who, text) VALUES (?, ?, ?)').run(clockMs(), who(ctx), text);
const event = (tripId, text) => db.prepare('INSERT INTO events(at_ms, trip_id, text) VALUES (?, ?, ?)').run(clockMs(), tripId, text);

// ---------- чтение данных ----------
const TRIP_SQL = 'SELECT t.*, s.name AS supplier FROM trips t JOIN suppliers s ON s.id = t.supplier_id';
function out(t) { // в таком виде рейс уходит клиенту (без телефона водителя)
  return { id: t.id, plate: t.plate, region: t.region, supplier: t.supplier, culture: t.culture, status: t.status, day: t.day, slot: t.slot,
    arrivedAt: t.arrived_at, finishedAt: t.finished_at, gross: t.gross, tare: t.tare, w: t.w, s: t.s, oil: t.oil,
    base: t.base_wb != null ? { wb: t.base_wb, sb: t.base_sb } : undefined, sdiz: t.sdiz, sdizNo: t.sdiz_no };
}
const findTrip = (id) => { const t = db.prepare(`${TRIP_SQL} WHERE t.id = ?`).get(Number(id)); if (!t) throw new Error('Рейс не найден'); return t; };
const cultures = () => ({ sun: { name: 'Подсолнечник', ...base() } });

function staffView(ctx) {
  const { day, min } = nowMsk();
  const trips = db.prepare(`${TRIP_SQL} WHERE t.day = ? OR (t.status = 'done' AND t.day >= ?) OR t.status = 'future' ORDER BY t.id`).all(day, addDays(day, -6));
  const season = db.prepare(`SELECT s.name, COUNT(t.id) cars FROM suppliers s LEFT JOIN trips t ON t.supplier_id = s.id AND t.status = 'done' GROUP BY s.id ORDER BY s.id`).all();
  const zachBySup = {};
  for (const t of db.prepare(`${TRIP_SQL} WHERE t.status = 'done'`).all()) zachBySup[t.supplier] = (zachBySup[t.supplier] || 0) + (zach(t) || 0);
  const v = {
    now: min, today: day, yesterday: addDays(day, -1), cultures: cultures(), baseChangedMs: getSetting('baseChangedMs', null),
    suppliers: season.map((s) => s.name), season: season.map((s) => ({ name: s.name, cars: s.cars, zach: zachBySup[s.name] || 0 })),
    trips: trips.map(out), events: [],
    me: { kind: 'staff', id: ctx.user.id, name: ctx.user.name, role: ctx.role, roleName: ROLES[ctx.role] }, roles: ROLES,
  };
  if (ctx.role === 'owner') {
    v.users = db.prepare('SELECT id, name, phone, role, active, last_login_ms FROM users ORDER BY id').all().map((u) => ({ ...u, active: !!u.active }));
    v.audit = db.prepare('SELECT at_ms, who, text FROM audit ORDER BY id DESC LIMIT 40').all();
  }
  return v;
}
function driverView(ctx) {
  const { day, min } = nowMsk();
  const waiting = db.prepare("SELECT id FROM trips WHERE day = ? AND status = 'arrived' ORDER BY arrived_at, id").all(day).map((r) => r.id);
  const mine = db.prepare(`${TRIP_SQL} WHERE t.driver_phone = ? AND (t.day >= ? OR t.status != 'done') ORDER BY t.day DESC, t.id DESC`).all(ctx.phone, addDays(day, -3))
    .map((t) => ({ ...out(t), queuePos: t.status === 'arrived' ? waiting.indexOf(t.id) + 1 : null }));
  const taken = db.prepare("SELECT day, slot FROM trips WHERE status IN ('booked','future') AND day BETWEEN ? AND ?").all(day, addDays(day, 2))
    .map((r) => ({ day: [day, addDays(day, 1), addDays(day, 2)].indexOf(r.day), slot: r.slot })); // только занятость — без чужих номеров
  const ids = mine.map((t) => t.id);
  const events = ids.length ? db.prepare(`SELECT id, at_ms, trip_id AS tripId, text FROM events WHERE trip_id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 10`).all(...ids).reverse() : [];
  return { now: min, today: day, cultures: cultures(), suppliers: db.prepare('SELECT name FROM suppliers ORDER BY id').all().map((r) => r.name),
    trips: mine, taken, events, me: { kind: 'driver', phone: maskPhone(ctx.phone) } };
}
const viewFor = (ctx) => (ctx.kind === 'staff' ? staffView(ctx) : driverView(ctx));

// ---------- действия: единственное место, где меняются данные ----------
// Push отправляем только после успешной записи в базу (облегчённый outbox): если действие упадёт,
// никто не получит уведомление о том, чего не случилось.
let pending = [];
const later = (fn) => pending.push(fn);
const upd = (id, fields) => { const keys = Object.keys(fields); db.prepare(`UPDATE trips SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id }); };
const actions = {
  invite({ id }, ctx) {
    const t = findTrip(id); if (t.status !== 'arrived') throw new Error('Машина не на площадке');
    upd(t.id, { status: 'weigh' });
    event(t.id, `${plateText(t)}: проезжайте на весовую №1`); audit(ctx, `${plateText(t)} приглашена на весовую`);
    if (t.driver_phone) later(() => push.toDriver(t.driver_phone, { title: 'Ваша очередь', body: `${plateText(t)}: проезжайте на весовую №1`, tag: `trip-${t.id}` }));
  },
  next(_, ctx) {
    const q = db.prepare("SELECT id FROM trips WHERE day = ? AND status = 'arrived' ORDER BY arrived_at, id LIMIT 1").get(nowMsk().day);
    if (!q) throw new Error('На площадке никого нет');
    actions.invite({ id: q.id }, ctx);
  },
  arrive({ id }, ctx) {
    const t = findTrip(id); if (t.status !== 'booked') throw new Error('Машина уже на площадке');
    upd(t.id, { status: 'arrived', arrived_at: nowMsk().min });
    event(t.id, `${plateText(t)} на площадке`); audit(ctx, `${plateText(t)}: отмечен въезд`);
  },
  driverArrive({ id }, ctx) {
    const t = findTrip(id);
    if (t.driver_phone !== ctx.phone) throw new Error('Рейс не найден'); // чужой рейс — как будто его нет (защита от IDOR)
    if (t.status !== 'booked') throw new Error('Отметить прибытие можно только в день записи');
    actions.arrive({ id }, ctx);
  },
  // Вес вводится вручную с табло весов; исправлять можно, пока машина на этом этапе — каждое изменение в журнал
  weigh({ id, kind, value }, ctx) {
    const t = findTrip(id);
    if (typeof value !== 'number' || !isFinite(value)) throw new Error('Введите вес в тоннах, например 39,60');
    value = Math.round(value * 100) / 100;
    let before;
    if (kind === 'gross') {
      if (t.status !== 'weigh') throw new Error('Брутто вводится, пока машина на весовой');
      if (value < 5 || value > 80) throw new Error('Брутто — от 5 до 80 т');
      before = t.gross; upd(t.id, { gross: value });
    } else if (kind === 'tare') {
      if (t.status !== 'unload') throw new Error('Тара вводится после выгрузки');
      if (value < 3 || value > 40) throw new Error('Тара — от 3 до 40 т');
      if (value >= t.gross) throw new Error('Тара должна быть меньше брутто');
      before = t.tare; upd(t.id, { tare: value });
    } else throw new Error('Неизвестный вид взвешивания');
    const name = kind === 'gross' ? 'брутто' : 'тара';
    if (before == null) audit(ctx, `${plateText(t)}: ${name} ${ru(value)} т`);
    else if (before !== value) {
      audit(ctx, `${plateText(t)}: ${name} исправлено ${ru(before)} → ${ru(value)} т`);
      later(() => push.toOwners({ title: 'Исправлен вес', body: `${plateText(t)}: ${name} ${ru(before)} → ${ru(value)} т. ${ctx.kind === 'staff' ? ctx.user.name : ''}`, tag: `weight-${t.id}` }, ctx.user && ctx.user.id));
    }
  },
  lab({ id, w, s, oil }, ctx) {
    const t = findTrip(id);
    if (t.status !== 'weigh') throw new Error('Анализ вносится, пока машина на весовой');
    for (const v of [w, s, oil]) if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) throw new Error('Показатели анализа — числа от 0 до 100');
    upd(t.id, { w, s, oil });
    audit(ctx, `${plateText(t)}: анализ — влажность ${ru(w, 1)}%, сор ${ru(s, 1)}%, масличность ${ru(oil, 1)}%`);
  },
  tounload({ id }, ctx) {
    const t = findTrip(id); if (t.gross == null || t.w == null) throw new Error('Нужны брутто и анализ');
    upd(t.id, { status: 'unload' });
    event(t.id, `${plateText(t)}: выгрузка, завальная яма №2`); audit(ctx, `${plateText(t)} отправлена на выгрузку`);
    if (t.driver_phone) later(() => push.toDriver(t.driver_phone, { title: 'Анализ готов', body: `${plateText(t)}: выгрузка — завальная яма №2`, tag: `trip-${t.id}` }));
  },
  finish({ id }, ctx) {
    const t = findTrip(id); if (t.tare == null) throw new Error('Нужна тара');
    const b = base();
    upd(t.id, { status: 'done', finished_at: nowMsk().min, base_wb: b.wb, base_sb: b.sb }); // фиксируем базис, по которому принят рейс
    const z = zach({ ...t, base_wb: b.wb, base_sb: b.sb });
    event(t.id, `${plateText(t)}: приёмка завершена, зачётный вес ${ru(z)} т`); audit(ctx, `${plateText(t)}: рейс завершён, зачёт ${ru(z)} т`);
    if (t.driver_phone) later(() => push.toDriver(t.driver_phone, { title: 'Приёмка завершена', body: `${plateText(t)}: зачётный вес ${ru(z)} т. Акт отправлен в хозяйство`, tag: `trip-${t.id}` }));
    if (t.w >= b.wetAlert) later(() => push.toOwners({ title: 'Влажная партия', body: `${plateText(t)}, ${t.supplier}: влажность ${ru(t.w, 1)}% — на сушку`, tag: `wet-${t.id}` }));
  },
  sdiz({ id }, ctx) { const t = findTrip(id); db.prepare("UPDATE trips SET sdiz = 'redeemed' WHERE id = ?").run(t.id); audit(ctx, `СДИЗ …${t.sdiz_no} погашен`); },
  book({ supplier, plate, region, day, slot }, ctx) {
    const raw = String(plate || '').toUpperCase().replace(/\s/g, '');
    if (!/^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}$/.test(raw)) throw new Error('Госномер в формате А 123 ВС');
    const sup = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(String(supplier || ''));
    if (!sup) throw new Error('Выберите хозяйство');
    if (![0, 1, 2].includes(day) || !Number.isInteger(slot) || slot < 0 || slot >= 24 * 60) throw new Error('Выберите день и время');
    const active = db.prepare("SELECT COUNT(*) c FROM trips WHERE driver_phone = ? AND status IN ('booked','future')").get(ctx.phone).c;
    if (active >= 5) throw new Error('Не больше 5 записей на один телефон');
    const { day: today } = nowMsk(), d = addDays(today, day);
    const reg = /^\d{2,3}$/.test(String(region)) ? String(region) : '93';
    const info = db.prepare(`INSERT INTO trips(plate, region, supplier_id, status, day, slot, sdiz_no, driver_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(raw, reg, sup.id, day === 0 ? 'booked' : 'future', d, slot, String(Math.floor(Math.random() * 9000) + 1000), ctx.phone);
    const t = findTrip(info.lastInsertRowid);
    event(t.id, `${plateText(t)} записана на ${['сегодня', 'завтра', 'послезавтра'][day]}, ${clock(slot)}`); audit(ctx, `${plateText(t)} записана на ${d} ${clock(slot)}`);
    return { id: t.id };
  },
  setBase({ wb, sb, wetAlert }, ctx) {
    const ok = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
    if (!ok(wb, 0, 20)) throw new Error('Базисная влажность — от 0 до 20%');
    if (!ok(sb, 0, 10)) throw new Error('Базисная сорная примесь — от 0 до 10%');
    if (!ok(wetAlert, wb, 30)) throw new Error('Порог «влажная партия» должен быть не ниже базисной влажности');
    setSetting('base', { wb, sb, wetAlert }); setSetting('baseChangedMs', clockMs());
    audit(ctx, `Базис изменён: влажность ${ru(wb, 1)}%, сор ${ru(sb, 1)}%, влажная партия от ${ru(wetAlert, 1)}%`);
    later(() => push.toOwners({ title: 'Изменён базис', body: `Влажность ${ru(wb, 1)}%, сорная примесь ${ru(sb, 1)}%. ${ctx.user.name}`, tag: 'base' }, ctx.user.id));
  },
  userCreate({ name, phone, role }, ctx) {
    const n = String(name || '').trim(), p = normPhone(phone);
    if (n.length < 2 || n.length > 60) throw new Error('Имя — от 2 до 60 символов');
    if (!phoneOk(p)) throw new Error('Телефон в формате +7 900 000-00-00');
    if (!Object.hasOwn(ROLES, role)) throw new Error('Выберите роль');
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(p)) throw new Error('Сотрудник с таким телефоном уже есть');
    const temp = crypto.randomBytes(4).toString('hex'); // временный пароль, показывается один раз
    db.prepare('INSERT INTO users(name, phone, role, pw_salt, pw_hash) VALUES (@n, @p, @role, @pw_salt, @pw_hash)').run({ n, p, role, ...hashPassword(temp) });
    audit(ctx, `Добавлен сотрудник: ${n}, ${ROLES[role]}`);
    return { tempPassword: temp };
  },
  userUpdate({ id, role, active }, ctx) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)); if (!u) throw new Error('Сотрудник не найден');
    if (u.id === ctx.user.id) throw new Error('Свою роль и доступ изменить нельзя');
    if (role !== undefined) { if (!Object.hasOwn(ROLES, role)) throw new Error('Неизвестная роль'); db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id); audit(ctx, `${u.name}: роль ${ROLES[u.role]} → ${ROLES[role]}`); }
    if (active !== undefined) { db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, u.id); audit(ctx, `${u.name}: доступ ${active ? 'включён' : 'отключён'}`); }
    if (role !== undefined || !active) dropSessions(u.id); // выходим со всех устройств
  },
  userResetPassword({ id }, ctx) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)); if (!u) throw new Error('Сотрудник не найден');
    const temp = crypto.randomBytes(4).toString('hex');
    db.prepare('UPDATE users SET pw_salt = @pw_salt, pw_hash = @pw_hash WHERE id = @id').run({ id: u.id, ...hashPassword(temp) });
    if (u.id !== ctx.user.id) dropSessions(u.id);
    audit(ctx, `${u.name}: пароль сброшен`);
    return { tempPassword: temp };
  },
  reset(_, ctx) { seed(); audit(ctx, 'Демо сброшено к исходным данным'); },
};

// ---------- живые обновления: каждый клиент получает своё представление ----------
const clients = new Set(); // { res, token, kind }
function broadcast() {
  for (const c of clients) {
    const ctx = sessionFromToken(c.token, c.kind);
    if (!ctx) { c.res.write('event: logout\ndata: {}\n\n'); c.res.end(); clients.delete(c); continue; }
    c.res.write(`data: ${JSON.stringify(viewFor(ctx))}\n\n`);
  }
}
// Раз в минуту: записи на сегодня становятся «записаны», проверяем долгое ожидание, чистим старые сессии
function tick() {
  const { day, min } = nowMsk();
  db.prepare("UPDATE trips SET status = 'booked' WHERE status = 'future' AND day <= ?").run(day);
  for (const t of db.prepare(`${TRIP_SQL} WHERE t.day = ? AND t.status = 'arrived' AND t.wait_notified = 0 AND ? - t.arrived_at >= 90`).all(day, min)) {
    db.prepare('UPDATE trips SET wait_notified = 1 WHERE id = ?').run(t.id);
    push.toOwners({ title: 'Долгое ожидание', body: `${plateText(t)}, ${t.supplier}: ждёт на площадке ${dur(min - t.arrived_at)}`, tag: `wait-${t.id}` });
  }
  db.prepare('DELETE FROM sessions WHERE expires_ms < ?').run(Date.now());
  broadcast();
}
setInterval(tick, 60 * 1000);
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25 * 1000); // не даём туннелю закрыть поток

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function lanUrls() { const o = []; for (const l of Object.values(os.networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) o.push(`http://${a.address}:${PORT}`); return o; }
function cors(req, res) {
  const o = req.headers.origin;
  if (o && ALLOWED_ORIGINS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App, ngrok-skip-browser-warning');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Max-Age', '600');
  }
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readJson(req, cb) { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20_000) req.destroy(); }); req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch { cb(null); } }); }
const ip = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const api = url.pathname.startsWith('/api/');
  if (api) cors(req, res);
  if (api && req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/api/info' && req.method === 'GET') {
    const staff = STAFF_SEED.map((d) => db.prepare('SELECT name, phone, role, active FROM users WHERE phone = ?').get(d.phone)).filter((u) => u && u.active)
      .map((u) => ({ name: u.name, phone: u.phone, role: u.role, roleName: ROLES[u.role] }));
    return json(res, 200, { ok: true, lan: lanUrls(), vapidKey: push.publicKey(), demo: { password: DEMO_PASSWORD, staff, drivers: DRIVER_PHONES } });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') return readJson(req, (b) => {
    const p = normPhone(b && b.phone);
    if (tooMany(`login:${ip(req)}`, 30, 600000) || tooMany(`loginph:${p}`, 5, 600000)) return json(res, 429, { ok: false, error: 'Слишком много неудачных попыток. Подождите 10 минут' });
    const u = db.prepare('SELECT * FROM users WHERE phone = ?').get(p);
    if (!u || !u.active || !checkPassword(b.password || '', u)) { hit(`login:${ip(req)}`); hit(`loginph:${p}`); return json(res, 401, { ok: false, error: 'Неверный телефон или пароль' }); }
    db.prepare('UPDATE users SET last_login_ms = ? WHERE id = ?').run(clockMs(), u.id);
    audit({ kind: 'staff', user: u, role: u.role }, 'Вход в систему');
    json(res, 200, { ok: true, token: newSession({ kind: 'staff', userId: u.id }) });
  });
  if (url.pathname === '/api/driver/code' && req.method === 'POST') return readJson(req, (b) => {
    const p = normPhone(b && b.phone);
    if (!phoneOk(p)) return json(res, 400, { ok: false, error: 'Телефон в формате +7 900 000-00-00' });
    if (limited(`code:${p}`, 3, 600000) || limited(`codeip:${ip(req)}`, 20, 600000)) return json(res, 429, { ok: false, error: 'Слишком много запросов кода. Подождите 10 минут' });
    const code = String(crypto.randomInt(1000, 10000));
    codes.set(p, { code, exp: Date.now() + 300000, tries: 0 });
    json(res, 200, { ok: true, demoCode: DEMO_SHOW_CODE ? code : undefined });
  });
  if (url.pathname === '/api/driver/login' && req.method === 'POST') return readJson(req, (b) => {
    const p = normPhone(b && b.phone), c = codes.get(p);
    if (!c || c.exp < Date.now()) return json(res, 401, { ok: false, error: 'Код устарел. Запросите новый' });
    if (++c.tries > 5) { codes.delete(p); return json(res, 429, { ok: false, error: 'Слишком много попыток. Запросите новый код' }); }
    if (String(b.code || '') !== c.code) return json(res, 401, { ok: false, error: 'Неверный код' });
    codes.delete(p);
    json(res, 200, { ok: true, token: newSession({ kind: 'driver', phone: p }) });
  });

  if (api) {
    const kind = appKind(req, url), ctx = sessionFromToken(bearer(req), kind);
    if (!ctx) return json(res, 401, { ok: false, error: 'Нужно войти' });

    if (url.pathname === '/api/logout' && req.method === 'POST') { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(ctx.token)); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { ok: true, me: viewFor(ctx).me });
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, viewFor(ctx));
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`data: ${JSON.stringify(viewFor(ctx))}\n\n`);
      const c = { res, token: ctx.token, kind }; clients.add(c);
      req.on('close', () => clients.delete(c));
      return;
    }
    if (url.pathname === '/api/push/subscribe' && req.method === 'POST') return readJson(req, (b) => {
      try {
        if (b?.app === 'owner' && ctx.role !== 'owner') throw new Error('Уведомления руководителя доступны только руководителю');
        push.saveSubscription(b && b.subscription, ctx, b && b.app); json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    });
    if (url.pathname === '/api/push/unsubscribe' && req.method === 'POST') return readJson(req, (b) => { push.removeSubscription(b && b.endpoint); json(res, 200, { ok: true }); });
    if (url.pathname === '/api/push/test' && req.method === 'POST') return readJson(req, async (b) => {
      if (limited(`pushtest:${ctx.token}`, 5, 60000)) return json(res, 429, { ok: false, error: 'Не чаще 5 раз в минуту' });
      await push.toSelf(ctx, b?.app === 'owner' ? 'owner' : 'driver', { title: 'Проверка уведомлений', body: 'Уведомления приходят. Так будут выглядеть сообщения о машинах.', tag: 'test' });
      json(res, 200, { ok: true });
    });
    if (url.pathname === '/api/action' && req.method === 'POST') return readJson(req, (b) => {
      try {
        if (!b) throw new Error('Некорректный запрос');
        const { type, ...payload } = b;
        if (!Object.hasOwn(actions, type) || !Object.hasOwn(PERMS, type)) throw new Error('Неизвестное действие');
        if (!PERMS[type].includes(ctx.role)) return json(res, 403, { ok: false, error: 'Недостаточно прав для этого действия' });
        pending = [];
        const result = db.transaction(() => actions[type](payload, ctx) || {})(); // действие целиком или никак
        const jobs = pending; pending = [];
        for (const job of jobs) job(); // уведомления — только после фиксации транзакции
        broadcast();
        json(res, 200, { ok: true, ...result });
      } catch (e) { pending = []; json(res, 400, { ok: false, error: e.message }); }
    });
    return json(res, 404, { ok: false, error: 'Не найдено' });
  }

  // статика (для работы без GitHub Pages): docs/
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(DOCS, p));
  if (!file.startsWith(DOCS)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  tick();
  console.log(`\nДемо «Приёмка» запущено · база: data/priemka.db`);
  console.log(`  На этом компьютере:  http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  В локальной сети:    ${u}`);
  console.log(`  Для телефона и GitHub Pages запустите туннель: npm run tunnel`);
  console.log(`  Вход сотрудников: +7 900 000-00-01…04, пароль ${DEMO_PASSWORD}\n`);
});
