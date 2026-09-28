// Push-уведомления (Web Push). Ключи VAPID создаются при первом запуске и хранятся в базе — не в git.
// Сервер шифрует сообщение и отправляет его в push-сервис браузера (Apple / Google / Mozilla),
// а тот доставляет на телефон, даже если приложение закрыто.
const webpush = require('web-push');
const { db, getSetting, setSetting } = require('./db');

let vapid = getSetting('vapid', null);
if (!vapid) { vapid = webpush.generateVAPIDKeys(); setSetting('vapid', vapid); }
webpush.setVapidDetails('https://bogdalleksss.github.io/maslozvddemo/', vapid.publicKey, vapid.privateKey);

const publicKey = () => vapid.publicKey;

function saveSubscription(sub, ctx, app) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Некорректная подписка');
  if (!['owner', 'driver'].includes(app)) throw new Error('Неизвестное приложение');
  db.prepare(`INSERT INTO push_subs(endpoint, p256dh, auth, kind, app, user_id, phone, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, kind = excluded.kind, app = excluded.app, user_id = excluded.user_id, phone = excluded.phone`)
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, ctx.kind, app, ctx.kind === 'staff' ? ctx.user.id : null, ctx.kind === 'driver' ? ctx.phone : null, Date.now());
}
const removeSubscription = (endpoint) => db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(String(endpoint || ''));

async function send(rows, payload) {
  const body = JSON.stringify(payload);
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, { TTL: 3600, urgency: 'high', timeout: 10000 });
    } catch (e) {
      // 404/410 — подписка больше не действует (удалили приложение, отозвали разрешение)
      if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(r.endpoint);
      else console.warn('push:', e.statusCode || '', e.body || e.message);
    }
  }));
}
// Водителю — только о его машинах
const toDriver = (phone, payload) => send(db.prepare("SELECT * FROM push_subs WHERE kind = 'driver' AND phone = ?").all(phone), { url: './', ...payload });
// Руководителям — в приложение руководителя
const toOwners = (payload, exceptUserId) => send(db.prepare(`SELECT p.* FROM push_subs p JOIN users u ON u.id = p.user_id
  WHERE p.app = 'owner' AND u.role = 'owner' AND u.active = 1 AND u.id IS NOT ?`).all(exceptUserId ?? null), { url: './', ...payload });
const toSelf = (ctx, app, payload) => send(ctx.kind === 'staff'
  ? db.prepare('SELECT * FROM push_subs WHERE user_id = ? AND app = ?').all(ctx.user.id, app)
  : db.prepare("SELECT * FROM push_subs WHERE phone = ? AND app = 'driver'").all(ctx.phone), { url: './', ...payload });

module.exports = { publicKey, saveSubscription, removeSubscription, toDriver, toOwners, toSelf };
