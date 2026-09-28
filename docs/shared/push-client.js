// Подписка на push-уведомления в приложении (руководитель / водитель).
// Сценарий на iPhone: Safari → «Поделиться» → «На экран Домой» → открыть с иконки → «Включить уведомления».
window.PushUI = (() => {
  const C = window.Core;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let reg = null, app = 'driver';

  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };

  async function init(appName) {
    app = appName;
    if (!('serviceWorker' in navigator)) return;
    try { reg = await navigator.serviceWorker.register('sw.js', { scope: './' }); } catch { reg = null; }
    // если уже подписаны — привязываем подписку к текущему входу (после смены пользователя)
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    if (sub && Notification.permission === 'granted') C.request('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), app } });
  }

  async function status() {
    if (isIOS && !standalone()) return 'install';
    if (!supported() || !reg) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  }

  async function enable() {
    const perm = await Notification.requestPermission(); // только по нажатию пользователя
    if (perm !== 'granted') { C.toast('Уведомления не разрешены. Их можно включить в настройках телефона', true); return; }
    const key = (await C.request('/api/info')).data.vapidKey;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    const r = await C.request('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), app } });
    if (!r.data.ok) { C.toast(r.data.error || 'Не удалось включить уведомления', true); return; }
    C.toast('Уведомления включены');
  }
  async function disable() {
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await C.request('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
    C.toast('Уведомления выключены');
  }
  async function test() {
    const r = await C.request('/api/push/test', { method: 'POST', body: { app } });
    C.toast(r.data.ok ? 'Отправили проверочное уведомление' : r.data.error, !r.data.ok);
  }

  // Карточка в приложении: что сейчас с уведомлениями и что нажать
  async function render(box, what) {
    const st = await status();
    const text = {
      install: ['Уведомления', 'Чтобы получать уведомления, добавьте приложение на экран «Домой»: кнопка «Поделиться» → «На экран Домой», затем откройте его с иконки.', ''],
      unsupported: ['Уведомления', 'Этот браузер не поддерживает уведомления. Откройте приложение в Safari или Chrome.', ''],
      denied: ['Уведомления запрещены', 'Разрешите уведомления для этого приложения в настройках телефона.', ''],
      off: ['Уведомления выключены', what, '<button class="btn btn-primary" data-push="on">Включить</button>'],
      on: ['Уведомления включены', what, '<button class="btn" data-push="test">Проверить</button><button class="btn" data-push="off">Выключить</button>'],
    }[st];
    box.innerHTML = `<div class="group"><div class="row push-row"><div class="main"><b>${text[0]}</b><span>${text[1]}</span></div></div>${text[2] ? `<div class="row push-actions">${text[2]}</div>` : ''}</div>`;
    box.onclick = async (e) => {
      const b = e.target.closest('[data-push]'); if (!b) return;
      b.disabled = true;
      try { if (b.dataset.push === 'on') await enable(); if (b.dataset.push === 'off') await disable(); if (b.dataset.push === 'test') await test(); }
      finally { render(box, what); }
    };
  }
  return { init, render, status };
})();
