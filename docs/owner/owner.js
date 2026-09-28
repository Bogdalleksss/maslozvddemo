const C = Core;
let S = null, tab = C.store.get('owner.tab') || 'today';
const TABS = [['today', 'Сегодня', C.icon.home], ['queue', 'Очередь', C.icon.truck], ['sup', 'Поставщики', C.icon.people]];

function today() {
  const st = C.stats(S), al = C.alerts(S);
  return `<h1 class="m-title">Сегодня</h1><p class="m-sub">${C.hm(S.now)} · подсолнечник</p>
  <div class="m-stack">
    <div class="m-grid2">
      <div class="stat hl"><span class="label">Принято</span><span class="value">${C.f1(st.zach)}<small>т</small></span><span class="foot">${st.count} машин</span></div>
      <div class="stat"><span class="label">На площадке</span><span class="value">${st.queue}</span><span class="foot">${st.queue ? 'до ' + C.dur(st.longest) : 'пусто'}</span></div>
      <div class="stat"><span class="label">На заводе</span><span class="value">${Math.round(st.stay)}<small>мин</small></span><span class="foot">в среднем</span></div>
      <div class="stat"><span class="label">Скидка</span><span class="value">${C.f1(st.disc)}<small>%</small></span><span class="foot">влага и сор</span></div>
    </div>
    <div><p class="group-title">Приёмка по часам, т</p><div class="group" style="padding:14px 12px 8px">${C.chart(S, { width: 360, height: 150 })}</div></div>
    <div><p class="group-title">Требует внимания</p><div class="group">
      ${al.length ? al.map((a) => `<div class="row"><span class="dot ${a.lvl}"></span><div class="main"><b>${C.esc(a.title)}</b><span>${C.esc(a.sub)}</span></div>${a.id ? `<button class="btn" data-invite="${a.id}">Позвать</button>` : ''}</div>`).join('') : '<div class="row"><div class="main muted">Всё в порядке</div></div>'}
    </div></div>
  </div>`;
}
function queue() {
  const w = C.waiting(S), work = [...C.by(S, 'weigh'), ...C.by(S, 'unload')], booked = C.by(S, 'booked').sort((a, b) => a.slot - b.slot);
  const grp = (title, rows, empty) => `<div><p class="group-title">${title}</p><div class="group">${rows || `<div class="row"><div class="main muted">${empty}</div></div>`}</div></div>`;
  return `<h1 class="m-title">Очередь</h1><p class="m-sub">${w.length} ждут · ${work.length} в работе · ${booked.length} записаны</p>
  <div class="m-stack">
    ${grp('Ждут на площадке', w.map((t) => { const m = S.now - t.arrivedAt; return `<div class="row"><div class="main"><b>${C.plate(t)}</b><span>${C.esc(t.supplier)}</span></div><span class="pill ${m >= 90 ? 'crit' : m >= 45 ? 'warn' : 'ok'}">${C.dur(m)}</span></div>`; }).join(''), 'Никого')}
    ${grp('В работе', work.map((t) => `<div class="row"><div class="main"><b>${C.plate(t)}</b><span>${t.status === 'weigh' ? 'весовая и лаборатория' : 'выгрузка'}</span></div></div>`).join(''), 'Никого')}
    ${grp('Записаны', booked.map((t) => `<div class="row"><div class="main"><b>${C.plate(t)}</b><span>${C.esc(t.supplier)}</span></div><span class="pill info">${C.hm(t.slot)}</span></div>`).join(''), 'Записей нет')}
  </div>`;
}
function sup() {
  return `<h1 class="m-title">Поставщики</h1><p class="m-sub">Сезон 2026, зачётный вес</p>
  <div class="group">${S.suppliers.map((n) => {
    const d = C.done(S).filter((t) => t.supplier === n); let z = 0, w = 0; d.forEach((t) => { z += C.calc(t, S.cultures).zach; w += t.w; });
    const se = S.season.find((x) => x.name === n) || { cars: 0, zach: 0 }, aw = d.length ? w / d.length : null;
    return `<div class="row"><div class="main"><b>${C.esc(n)}</b><span>${se.cars} машин за сезон${aw != null ? ' · влажность ' + C.f1(aw) + '%' : ''}</span></div><span class="end mono"><b>${C.f1(se.zach)}</b> т</span></div>`;
  }).join('')}</div>`;
}
const VIEWS = { today, queue, sup };
function render() {
  if (!S) return;
  document.getElementById('view').innerHTML = VIEWS[tab]();
  document.getElementById('push-box').hidden = tab !== 'today';
  document.getElementById('tabs').innerHTML = TABS.map(([k, n, ic]) => `<button data-tab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${ic}${n}</button>`).join('');
}
document.addEventListener('click', async (e) => {
  const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; C.store.set('owner.tab', tab); render(); window.scrollTo(0, 0); return; }
  const inv = e.target.closest('[data-invite]'); if (inv) { try { await C.act('invite', { id: Number(inv.dataset.invite) }); C.toast('Машина приглашена на весовую'); } catch {} }
});
(async () => {
  await C.requireAuth({ kind: 'staff', roles: ['owner'], app: 'приложение руководителя' }); // только руководитель
  await PushUI.init('owner');
  PushUI.render(document.getElementById('push-box'), 'Долгое ожидание машин, влажные партии, исправления веса и изменения базиса.');
  document.getElementById('mark').innerHTML = C.icon.seed;
  const out = document.getElementById('out'); out.innerHTML = C.icon.logout; out.onclick = C.logout;
  C.live((st) => { S = st; render(); }, (ok) => { document.getElementById('conn').innerHTML = ok ? '<span class="dot ok"></span>онлайн' : '<span class="dot crit"></span>нет связи'; });
})();
