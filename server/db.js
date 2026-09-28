// База данных демо: SQLite-файл data/priemka.db (better-sqlite3 — синхронный и быстрый драйвер).
// Здесь схема, заполнение демо-данными и работа со временем по Москве.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'priemka.db'));
db.pragma('journal_mode = WAL');   // читатели не блокируют запись
db.pragma('foreign_keys = ON');

// ---------- время: «сегодня» и минуты от полуночи по Москве ----------
// Демо-часы: если демо сбросили ночью, часы сдвигаются на дневную смену (14:20), чтобы было что показать.
// Сдвиг хранится в базе и применяется ко всем меткам времени — журнал, очередь и уведомления не расходятся.
const TZ = 'Europe/Moscow';
let clockOffset = 0;
const clockMs = () => Date.now() + clockOffset;
function nowMsk() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(clockMs())).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
function addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---------- схема ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, role TEXT NOT NULL,
  pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_login_ms INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('staff','driver')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, phone TEXT, expires_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers ( id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE );
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY, plate TEXT NOT NULL, region TEXT NOT NULL, supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  culture TEXT NOT NULL DEFAULT 'sun',
  status TEXT NOT NULL CHECK (status IN ('future','booked','arrived','weigh','unload','done')),
  day TEXT NOT NULL, slot INTEGER, arrived_at INTEGER, finished_at INTEGER,
  gross REAL, tare REAL, w REAL, s REAL, oil REAL, base_wb REAL, base_sb REAL,
  sdiz TEXT NOT NULL DEFAULT 'pending', sdiz_no TEXT NOT NULL, driver_phone TEXT, wait_notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trips_day_status ON trips(day, status);
CREATE INDEX IF NOT EXISTS trips_driver ON trips(driver_phone);
CREATE TABLE IF NOT EXISTS events ( id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, trip_id INTEGER, text TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS audit ( id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, who TEXT NOT NULL, text TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  kind TEXT NOT NULL, app TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, phone TEXT, created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_user ON push_subs(user_id);
CREATE INDEX IF NOT EXISTS push_phone ON push_subs(phone);
`);

const getSetting = (k, def) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? JSON.parse(r.value) : def; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
clockOffset = getSetting('clockOffsetMs', 0);

// ---------- пароли ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return { pw_salt: salt.toString('hex'), pw_hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}
function checkPassword(pw, u) {
  const h = crypto.scryptSync(String(pw), Buffer.from(u.pw_salt, 'hex'), 32);
  return crypto.timingSafeEqual(h, Buffer.from(u.pw_hash, 'hex'));
}

// ---------- демо-данные ----------
const DEMO_PASSWORD = 'demo2026';
const STAFF_SEED = [
  { name: 'Андрей Смирнов', role: 'owner', phone: '79000000001' },
  { name: 'Ольга Кравец', role: 'weigher', phone: '79000000002' },
  { name: 'Дарья Лебедь', role: 'lab', phone: '79000000003' },
  { name: 'Марина Ткач', role: 'accountant', phone: '79000000004' },
];
const DRIVER_PHONES = ['79001112233', '79004445566'];
const SUPPLIERS = ['КФХ «Рассвет»', 'СПК «Заря»', 'ООО «Степь-Агро»', 'КФХ «Подсолнух»', 'ООО «Зелёный клин»', 'КФХ «Кубанский колос»', 'ООО «Агро-Юг»', 'КФХ «Нива»'];
const DEFAULT_BASE = { wb: 7, sb: 1, wetAlert: 10 };

const LETTERS = 'АВЕКМНОРСТУХ';
const rnd = (a, b) => a + Math.random() * (b - a);
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function plate() { return pick(LETTERS) + String(Math.floor(rnd(100, 999))) + pick(LETTERS) + pick(LETTERS); }
const region = () => pick(['93', '93', '123', '23']);
// Показатели качества: у каждого хозяйства свой «характер» — одни сдают сухую семечку, другие влажную
const quality = (supIdx) => {
  const wet = [0, 1.2, 0.3, 1.8, 2.4, 0.6, 0.1, 1.0][supIdx];
  return { w: r1(rnd(6.4, 8.6) + wet * Math.random()), s: r1(rnd(0.8, 2.2) + wet * 0.5 * Math.random()), oil: r1(rnd(46.5, 51) - wet * 0.4) };
};

function seed() {
  // ночью (20:00–08:00) демо стартует с дневной смены 14:20; днём — реальное время
  clockOffset = 0;
  const real = nowMsk();
  clockOffset = real.min < 8 * 60 || real.min >= 20 * 60 ? (14 * 60 + 20 - real.min) * 60000 : 0;
  setSetting('clockOffsetMs', clockOffset);
  const tx = db.transaction(() => {
    db.exec('DELETE FROM trips; DELETE FROM events; DELETE FROM suppliers;');
    SUPPLIERS.forEach((n) => db.prepare('INSERT INTO suppliers(name) VALUES (?)').run(n));
    const supIds = db.prepare('SELECT id FROM suppliers ORDER BY id').all().map((r) => r.id);
    if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
      for (const u of STAFF_SEED) db.prepare('INSERT INTO users(name, phone, role, pw_salt, pw_hash) VALUES (@name, @phone, @role, @pw_salt, @pw_hash)').run({ ...u, ...hashPassword(DEMO_PASSWORD) });
    }
    setSetting('base', DEFAULT_BASE);
    setSetting('baseChangedMs', null);

    const ins = db.prepare(`INSERT INTO trips(plate, region, supplier_id, status, day, slot, arrived_at, finished_at, gross, tare, w, s, oil, base_wb, base_sb, sdiz, sdiz_no, driver_phone, wait_notified)
      VALUES (@plate, @region, @supplier_id, @status, @day, @slot, @arrived_at, @finished_at, @gross, @tare, @w, @s, @oil, @base_wb, @base_sb, @sdiz, @sdiz_no, @driver_phone, @wait_notified)`);
    let sdizSeq = 4700;
    const done = (day, finished, supIdx, extra = {}) => {
      const q = quality(supIdx), tare = r1(rnd(14.0, 16.0)), gross = r1(tare + rnd(21.5, 26.5));
      ins.run({ plate: plate(), region: region(), supplier_id: supIds[supIdx], status: 'done', day, slot: null, arrived_at: finished - Math.round(rnd(45, 100)), finished_at: finished,
        gross, tare, ...q, base_wb: 7, base_sb: 1, sdiz: 'redeemed', sdiz_no: String(++sdizSeq).slice(-4), driver_phone: null, wait_notified: 1, ...extra });
    };
    const { day: today, min: now } = nowMsk();

    // прошлые 10 дней: 18–26 машин в день с 06:30 до 19:30
    for (let d = 10; d >= 1; d--) {
      const day = addDays(today, -d), n = Math.floor(rnd(18, 27));
      for (let i = 0; i < n; i++) done(day, Math.round(390 + (i + Math.random() * 0.6) * (780 / n)), Math.floor(Math.random() * SUPPLIERS.length),
        d === 1 && i >= n - 2 ? { sdiz: 'pending' } : {});
    }
    // водитель К 482 МР уже привозил семечку вчера и позавчера
    done(addDays(today, -1), 10 * 60 + 5, 2, { plate: 'К482МР', region: '93', driver_phone: DRIVER_PHONES[0] });
    done(addDays(today, -2), 15 * 60 + 40, 2, { plate: 'К482МР', region: '93', driver_phone: DRIVER_PHONES[0] });

    // сегодня: завершённые с 06:30 до «сейчас минус 50 минут», примерно каждые 35 минут
    const endDone = Math.max(390, now - 50);
    for (let t = 400; t <= endDone; t += Math.round(rnd(28, 42))) done(today, t, Math.floor(Math.random() * SUPPLIERS.length), t > endDone - 120 ? { sdiz: 'pending' } : {}); // последние 2 часа — СДИЗ ещё не погашены

    // сегодня: в работе и в очереди — относительно текущего времени
    const at = (m) => Math.max(0, now - m);
    const q2 = quality(3);
    ins.run({ plate: 'К316АР', region: '123', supplier_id: supIds[3], status: 'unload', day: today, slot: null, arrived_at: at(140), finished_at: null, gross: 39.2, tare: null, w: q2.w, s: q2.s, oil: q2.oil, base_wb: null, base_sb: null, sdiz: 'pending', sdiz_no: String(++sdizSeq).slice(-4), driver_phone: null, wait_notified: 1 });
    ins.run({ plate: 'Е830ОК', region: '93', supplier_id: supIds[1], status: 'weigh', day: today, slot: null, arrived_at: at(115), finished_at: null, gross: null, tare: null, w: null, s: null, oil: null, base_wb: null, base_sb: null, sdiz: 'pending', sdiz_no: String(++sdizSeq).slice(-4), driver_phone: null, wait_notified: 1 });
    const arrived = [['М925ХВ', '93', 0, 105, null, 1], ['Н471ЕС', '23', 4, 70, null, 0], ['К482МР', '93', 2, 40, DRIVER_PHONES[0], 0], ['О368ТА', '123', 3, 15, null, 0]];
    for (const [p, r, s, ago, phone, notified] of arrived) ins.run({ plate: p, region: r, supplier_id: supIds[s], status: 'arrived', day: today, slot: null, arrived_at: at(ago), finished_at: null, gross: null, tare: null, w: null, s: null, oil: null, base_wb: null, base_sb: null, sdiz: 'pending', sdiz_no: String(++sdizSeq).slice(-4), driver_phone: phone, wait_notified: notified });
    // записаны: ближайшие слоты по 20 минут
    const nextSlot = (plus) => Math.min(23 * 60, Math.ceil((now + plus) / 20) * 20);
    const booked = [['Р559УК', '93', 1, 20, DRIVER_PHONES[1]], ['С713МН', '23', 0, 60, null], ['Т204ОЕ', '93', 4, 100, null]];
    for (const [p, r, s, plus, phone] of booked) ins.run({ plate: p, region: r, supplier_id: supIds[s], status: 'booked', day: today, slot: nextSlot(plus), arrived_at: null, finished_at: null, gross: null, tare: null, w: null, s: null, oil: null, base_wb: null, base_sb: null, sdiz: 'pending', sdiz_no: String(++sdizSeq).slice(-4), driver_phone: phone, wait_notified: 0 });
    // записи на завтра
    for (const [p, s, slot] of [['У118КМ', 5, 8 * 60], ['Х745ВН', 6, 9 * 60 + 20], ['А902СТ', 7, 10 * 60 + 40]]) ins.run({ plate: p, region: '93', supplier_id: supIds[s], status: 'future', day: addDays(today, 1), slot, arrived_at: null, finished_at: null, gross: null, tare: null, w: null, s: null, oil: null, base_wb: null, base_sb: null, sdiz: 'pending', sdiz_no: String(++sdizSeq).slice(-4), driver_phone: null, wait_notified: 0 });
  });
  tx();
}

// первый запуск — заполняем базу
if (!db.prepare('SELECT COUNT(*) c FROM trips').get().c) seed();

module.exports = { db, seed, nowMsk, clockMs, addDays, getSetting, setSetting, hashPassword, checkPassword, DEMO_PASSWORD, STAFF_SEED, DRIVER_PHONES };
