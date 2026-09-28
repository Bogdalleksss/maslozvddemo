// Водитель видит только свои рейсы: сервер присылает их уже отфильтрованными (с местом в очереди).
const C = Core;
let S = null, tab = 'my', picking = false, lastEvent = null, myId = null;
const booking = { supplier: 'ООО «Степь-Агро»', plate: '', region: '93', day: 0, slot: null };
const TABS = [['my', 'Мои машины', C.icon.truck], ['book', 'Запись', C.icon.cal]];
const STEPS = [['booked', 'Запись на выгрузку'], ['arrived', 'Ожидание на площадке'], ['weigh', 'Весовая и проба'], ['unload', 'Выгрузка и тара'], ['done', 'Приёмка завершена']];
const ORDER = { weigh: 0, unload: 1, arrived: 2, booked: 3, future: 4, done: 5 };

const addDay = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayName = (d) => (d === S.today ? 'сегодня' : d === addDay(S.today, 1) ? 'завтра' : new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
function mine() {
  let t = S.trips.find((x) => x.id === myId);
  if (!t) { t = [...S.trips].sort((a, b) => ORDER[a.status] - ORDER[b.status])[0]; myId = t && t.id; }
  return t;
}
function my() {
  const t = mine();
  if (!t) return `<h1 class="m-title">Мои машины</h1><p class="m-sub">${C.esc(S.me.phone)}</p>
    <div class="hero"><span class="cap">Записей пока нет</span><h2>Запишитесь на выгрузку, чтобы не ждать у ворот</h2></div>
    <div style="margin-top:20px"><button class="btn btn-primary btn-lg" data-tab="book">Записаться</button></div>`;
  if (picking) return pick();
  const idx = t.status === 'future' ? 0 : STEPS.findIndex((s) => s[0] === t.status);
  let hero = '';
  if (t.status === 'future') hero = `<span class="cap">Запись на ${C.esc(dayName(t.day))}</span><div class="big">${C.hm(t.slot)}</div><p>Накануне пришлём напоминание.</p>`;
  if (t.status === 'booked') hero = `<span class="cap">Запись на сегодня</span><div class="big">${C.hm(t.slot)}</div><p>Когда въедете на территорию, нажмите «Я на месте».</p>`;
  if (t.status === 'arrived') hero = `<span class="cap">Место в очереди</span><div class="big">${t.queuePos}</div><p>Примерно через ${C.dur(t.queuePos * 18)} позовём на весовую.</p>`;
  if (t.status === 'weigh') hero = `<span class="cap">Ваша очередь</span><h2>Проезжайте на весовую №1</h2><p>После взвешивания возьмут пробу из кузова.</p>`;
  if (t.status === 'unload') hero = `<span class="cap">Анализ готов</span><h2>Выгрузка: завальная яма №2</h2><p>Затем вернитесь на весовую для взвешивания тары.</p>`;
  if (t.status === 'done') { const c = C.calc(t, S.cultures); hero = `<span class="cap">Зачётный вес</span><div class="big">${C.f2(c.zach)}<small> т</small></div><p>Приёмка завершена в ${C.hm(t.finishedAt)}. Акт отправлен в хозяйство.</p>`; }
  const c = C.calc(t, S.cultures);
  const res = t.gross != null ? `<div><p class="group-title">Результаты</p><div class="group res">
    ${[['Брутто', t.gross, ' т', C.f2], ['Тара', t.tare, ' т', C.f2], ['Нетто', c.netto, ' т', C.f2], ['Влажность', t.w, '%', C.f1], ['Сорная примесь', t.s, '%', C.f1], ['Масличность', t.oil, '%', C.f1], ['Зачётный вес', c.zach, ' т', C.f2]]
      .map(([n, v, u, f]) => `<div class="row${n === 'Зачётный вес' ? ' total' : ''}"><div class="main">${n}</div><span class="end">${v != null ? f(v) + u : '—'}</span></div>`).join('')}</div></div>` : '';
  return `<div class="m-title">${C.plate(t, true)}</div><p class="m-sub">${C.esc(t.supplier)} · подсолнечник</p>
  <div class="m-stack">
    <div class="hero">${hero}</div>
    ${t.status === 'booked' ? '<button class="btn btn-primary btn-lg" data-act="arrive">Я на месте</button>' : ''}
    <div class="group steps">${STEPS.map((s, i) => `<div class="step ${i < idx || t.status === 'done' ? 'done' : i === idx ? 'cur' : ''}"><span class="c"></span>${s[1]}</div>`).join('')}</div>
    ${res}
    ${S.trips.length > 1 ? `<div class="switch"><button class="btn btn-link" data-act="pick">Все мои машины · ${S.trips.length}</button></div>` : ''}
  </div>`;
}
function pick() {
  const list = [...S.trips].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const st = { future: 'запись', booked: 'запись на сегодня', arrived: 'в очереди', weigh: 'на весовой', unload: 'на выгрузке', done: 'принята' };
  return `<h1 class="m-title">Мои машины</h1><p class="m-sub">${C.esc(S.me.phone)}</p>
  <div class="group">${list.map((t) => `<div class="row tap" data-choose="${t.id}"><div class="main"><b>${C.plate(t)}</b><span>${C.esc(t.supplier)} · ${st[t.status]}${t.slot != null && (t.status === 'booked' || t.status === 'future') ? ' ' + C.hm(t.slot) : ''}</span></div>${t.id === myId ? '<span class="t-ok">открыта</span>' : '<span class="chev">›</span>'}</div>`).join('')}</div>`;
}
function slotsFor(day) {
  const base = [8 * 60, 9 * 60 + 20, 10 * 60 + 40, 12 * 60, 13 * 60 + 20, 14 * 60 + 40, 16 * 60, 17 * 60 + 20, 18 * 60 + 40];
  const cap = [[0, 0, 0, 0, 0, 1, 2, 3, 3], [1, 0, 2, 3, 1, 3, 2, 3, 3], [3, 3, 2, 3, 3, 3, 3, 3, 3]][day];
  return base.map((m, i) => {
    let left = day === 0 && m <= S.now ? 0 : cap[i];
    left -= S.taken.filter((t) => t.day === day && t.slot === m).length; // сервер присылает только занятость, без чужих номеров
    return { m, left: Math.max(0, left) };
  });
}
function book() {
  const b = booking;
  return `<h1 class="m-title">Запись</h1><p class="m-sub">Приезжайте к своему времени, без ожидания у ворот</p>
  <div class="m-stack">
    <div class="group form">
      <div class="field"><label for="b-sup">Хозяйство</label><select id="b-sup" data-b="supplier">${S.suppliers.map((s) => `<option ${s === b.supplier ? 'selected' : ''}>${C.esc(s)}</option>`).join('')}</select></div>
      <div class="two"><div class="field"><label for="b-plate">Госномер</label><input id="b-plate" data-b="plate" placeholder="А 123 ВС" value="${C.esc(b.plate)}" autocomplete="off" autocapitalize="characters"></div>
      <div class="field"><label for="b-reg">Регион</label><input id="b-reg" data-b="region" inputmode="numeric" value="${C.esc(b.region)}"></div></div>
    </div>
    <div class="segmented" style="justify-self:start">${['Сегодня', 'Завтра', dayName(addDay(S.today, 2))].map((d, i) => `<button data-day="${i}" aria-pressed="${b.day === i}">${d}</button>`).join('')}</div>
    <div class="slots">${slotsFor(b.day).map((s) => `<button class="slot ${s.left === 1 ? 'busy' : ''}" data-slot="${s.m}" ${s.left ? '' : 'disabled'} aria-pressed="${b.slot === s.m}"><b>${C.hm(s.m)}</b><span>${s.left ? s.left === 1 ? '1 место' : 'свободно' : 'занято'}</span></button>`).join('')}</div>
    <button class="btn btn-primary btn-lg" data-act="book" ${b.slot == null ? 'disabled' : ''}>Записаться${b.slot != null ? ' на ' + C.hm(b.slot) : ''}</button>
    <p class="muted" style="text-align:center;font-size:13px;margin:0">Вызов на весовую придёт в Telegram или по SMS</p>
  </div>`;
}
function render() {
  if (!S) return;
  const active = document.activeElement;
  if (tab === 'book' && active && active.matches('input')) return; // не сбиваем ввод номера
  document.getElementById('view').innerHTML = tab === 'my' ? my() : book();
  document.getElementById('push-box').hidden = tab !== 'my';
  document.getElementById('tabs').innerHTML = TABS.map(([k, n, ic]) => `<button data-tab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${ic}${n}</button>`).join('');
}
function notify() {
  const ev = S.events[S.events.length - 1];
  if (ev && lastEvent !== null && ev.id !== lastEvent) C.toast(ev.text);
  lastEvent = ev ? ev.id : 0;
}
document.addEventListener('click', async (e) => {
  const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; picking = false; render(); window.scrollTo(0, 0); return; }
  const ch = e.target.closest('[data-choose]'); if (ch) { myId = Number(ch.dataset.choose); picking = false; render(); return; }
  const d = e.target.closest('[data-day]'); if (d) { booking.day = Number(d.dataset.day); booking.slot = null; render(); return; }
  const sl = e.target.closest('[data-slot]'); if (sl && !sl.disabled) { booking.slot = Number(sl.dataset.slot); render(); return; }
  const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
  try {
    if (a.dataset.act === 'pick') { picking = true; render(); }
    if (a.dataset.act === 'arrive') { await C.act('driverArrive', { id: myId }); }
    if (a.dataset.act === 'book') {
      const r = await C.act('book', { ...booking });
      myId = r.id; C.toast('Запись подтверждена'); booking.plate = ''; booking.slot = null; tab = 'my'; render();
    }
  } catch {}
});
document.addEventListener('input', (e) => { const k = e.target.dataset.b; if (k) booking[k] = e.target.value; });
document.addEventListener('change', (e) => { if (e.target.dataset.b === 'supplier') booking.supplier = e.target.value; });
(async () => {
  await C.requireAuth({ kind: 'driver', app: 'водитель' }); // вход по SMS-коду
  await PushUI.init('driver');
  PushUI.render(document.getElementById('push-box'), 'Вызов на весовую, выгрузка и результат приёмки ваших машин.');
  document.getElementById('mark').innerHTML = C.icon.seed;
  const out = document.getElementById('out'); out.innerHTML = C.icon.logout; out.onclick = C.logout;
  C.live((st) => { S = st; notify(); render(); }, (ok) => { document.getElementById('conn').innerHTML = ok ? '<span class="dot ok"></span>онлайн' : '<span class="dot crit"></span>нет связи'; });
})();
