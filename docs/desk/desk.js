// Рабочее место приёмщика (ПК)
const C = Core;
let S = null;                         // последнее состояние с сервера
let page = C.store.get('desk.page') || 'queue';
let filter = 'all', period = 'today';
let openId = null;                    // открытая карточка рейса
const weights = {};                   // черновики веса: {'id:gross': '39,60'}
const drafts = {};                    // черновики анализа: {id: {w, s, oil}}

const PAGES = [['summary', 'Сводка', 'grid'], ['queue', 'Очередь', 'truck'], ['journal', 'Журнал приёмки', 'list'], ['suppliers', 'Поставщики', 'people'], ['settings', 'Базис', 'sliders'], ['staff', 'Сотрудники', 'team']];
// Что видит и может каждая роль. Это только интерфейс — права всё равно проверяет сервер.
const ROLE_PAGES = { owner: ['summary', 'queue', 'journal', 'suppliers', 'settings', 'staff'], weigher: ['queue', 'summary', 'journal'], lab: ['queue', 'journal'], accountant: ['summary', 'journal', 'suppliers'] };
const CAN = { queue: ['owner', 'weigher'], lab: ['owner', 'weigher', 'lab'], sdiz: ['owner', 'accountant'], export: ['owner', 'accountant'] };
const can = (k) => !!S && CAN[k].includes(S.me.role);
const waitLvl = (m) => (m >= 90 ? 'crit' : m >= 45 ? 'warn' : 'ok');

// ---------- Сводка ----------
function summary() {
  const st = C.stats(S), al = C.alerts(S);
  return `
  <div class="head"><div><h1>Сводка смены</h1><p>${C.esc(longDate(S.today))} · подсолнечник, сезон ${S.today.slice(0, 4)}</p></div>
    <div class="actions"><button class="btn" data-page="queue">Очередь</button><button class="btn btn-primary" data-page="journal">Журнал приёмки</button></div></div>
  <div class="stats">
    <div class="stat hl"><span class="label">Принято, зачётный вес</span><span class="value">${C.f1(st.zach)}<small>т</small></span><span class="foot">${st.count} машин · физический ${C.f1(st.netto)} т</span></div>
    <div class="stat"><span class="label">На площадке</span><span class="value">${st.queue}<small>машин</small></span><span class="foot">${st.queue ? 'дольше всех ждёт ' + C.dur(st.longest) : 'очереди нет'}</span></div>
    <div class="stat"><span class="label">Время на заводе</span><span class="value">${Math.round(st.stay)}<small>мин</small></span><span class="foot">от въезда до тары, в среднем</span></div>
    <div class="stat"><span class="label">Скидка на влагу и сор</span><span class="value">${C.f1(st.disc)}<small>%</small></span><span class="foot">масличность ${C.f1(st.oil)}%</span></div>
  </div>
  <div class="cols">
    <div class="panel"><h2>Приёмка по часам, т зачётного веса <span class="muted">тёмным — текущий час</span></h2>${C.chart(S)}</div>
    <div><p class="group-title">Требует внимания</p><div class="group">
      ${al.length ? al.map((a) => `<div class="row"><span class="dot ${a.lvl === 'accent' ? 'info' : a.lvl}"></span><div class="main"><b>${C.esc(a.title)}</b><span>${C.esc(a.sub)}</span></div>
        ${a.id && can('queue') ? `<button class="btn" data-act="invite" data-id="${a.id}">Пригласить</button>` : a.go && ROLE_PAGES[S.me.role].includes(a.go) ? `<button class="btn" data-page="${a.go}">Открыть</button>` : ''}</div>`).join('') : '<div class="empty">Всё в порядке</div>'}
    </div></div>
  </div>`;
}

// ---------- Очередь: канбан ----------
function card(t) {
  let top = '', body = '', btn = '', open = false;
  if (t.status === 'booked') { top = `<span class="pill info">${C.hm(t.slot)}</span>`; body = 'по записи'; btn = `<button class="btn" data-act="arrive" data-id="${t.id}">Отметить въезд</button>`; }
  if (t.status === 'arrived') { const m = S.now - t.arrivedAt; top = `<span class="pill ${waitLvl(m)}">${C.dur(m)}</span>`; body = `на площадке с ${C.hm(t.arrivedAt)}`; btn = `<button class="btn btn-primary" data-act="invite" data-id="${t.id}">Пригласить на весовую</button>`; }
  if (t.status === 'weigh') { open = true; body = t.gross == null ? 'ждёт взвешивания брутто' : t.w == null ? `брутто <b>${C.f2(t.gross)}</b> т · ждёт анализ` : 'анализ готов'; }
  if (t.status === 'unload') { open = true; body = t.tare == null ? `влажн. <b>${C.f1(t.w)}</b>% · сор <b>${C.f1(t.s)}</b>% · ждёт тару` : 'готов к завершению'; }
  if (t.status === 'done') { open = true; top = `<span class="muted mono" style="font-size:12px">${C.hm(t.finishedAt)}</span>`; body = `зачёт <b>${C.f2(C.calc(t, S.cultures).zach)}</b> т`; }
  if (!can('queue')) btn = '';
  return `<div class="card${open ? ' open' : ''}"${open ? ` data-open="${t.id}" tabindex="0"` : ''}>
    <div class="top">${C.plate(t)}${top}</div><div class="sup">${C.esc(t.supplier)}</div><div class="meta">${body}</div>${btn}</div>`;
}
function queue() {
  const cols = [
    ['booked', 'Записаны', 'info', C.by(S, 'booked').sort((a, b) => a.slot - b.slot)],
    ['arrived', 'На площадке', 'warn', C.waiting(S)],
    ['weigh', 'Весовая и лаборатория', 'accent', C.by(S, 'weigh')],
    ['unload', 'Выгрузка', 'ok', C.by(S, 'unload')],
    ['done', 'Завершены сегодня', '', C.done(S)],
  ];
  const w = C.waiting(S);
  return `
  <div class="head"><div><h1>Очередь машин</h1><p>Машины в работе открываются по нажатию: взвешивание, анализ, тара</p></div>
    <div class="actions">${can('queue') ? `<button class="btn btn-primary" data-act="next" ${w.length ? '' : 'disabled'}>Пригласить следующую</button>` : ''}</div></div>
  <div class="board">${cols.map(([k, name, dot, list]) => {
    const shown = k === 'done' ? list.slice(0, 4) : list;
    return `<section class="col" aria-label="${name}"><div class="col-head"><span class="dot ${dot}"></span>${name}<span class="c">${list.length}</span></div>
      ${shown.length ? shown.map(card).join('') : '<div class="empty">Пусто</div>'}
      ${k === 'done' && list.length > 4 ? `<button class="more" data-page="journal">Весь журнал · ${list.length}</button>` : ''}</section>`;
  }).join('')}</div>`;
}

// ---------- Журнал ----------
const longDate = (d) => { const s = new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }); return s[0].toUpperCase() + s.slice(1); };
function journal() {
  let d = C.doneAll(S);
  if (period === 'today') d = d.filter((t) => t.day === S.today);
  if (period === 'yesterday') d = d.filter((t) => t.day === S.yesterday);
  if (filter === 'wet') d = d.filter((t) => t.w >= 9);
  if (filter === 'sdiz') d = d.filter((t) => t.sdiz === 'pending');
  let netto = 0, zsum = 0; d.forEach((t) => { const c = C.calc(t, S.cultures); netto += c.netto; zsum += c.zach; });
  const many = period === 'week';
  return `
  <div class="head"><div><h1>Журнал приёмки</h1><p>${d.length} рейсов · ${C.f1(netto)} т физический · ${C.f1(zsum)} т зачётный</p></div>
    <div class="actions">${can('export') ? '<button class="btn" data-act="export">Выгрузить в 1С</button>' : ''}</div></div>
  <div style="display:flex;gap:10px 20px;flex-wrap:wrap"><div class="segmented">${[['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', '7 дней']].map(([k, n]) => `<button data-period="${k}" aria-pressed="${period === k}">${n}</button>`).join('')}</div>
  <div class="segmented">${[['all', 'Все'], ['wet', 'Влажность от 9%'], ['sdiz', 'СДИЗ не погашен']].map(([k, n]) => `<button data-filter="${k}" aria-pressed="${filter === k}">${n}</button>`).join('')}</div></div>
  <div class="table"><table><thead><tr><th>${many ? 'Дата и время' : 'Время'}</th><th>Машина</th><th>Поставщик</th><th class="r">Нетто, т</th><th class="r">Влажн., %</th><th class="r">Сор, %</th><th class="r">Масличн., %</th><th class="r">Зачёт, т</th><th>СДИЗ</th></tr></thead><tbody>
  ${d.map((t) => { const c = C.calc(t, S.cultures); return `<tr class="tap" data-open="${t.id}"><td class="m">${many ? C.esc(C.dayLabel(S, t.day)) + ', ' : ''}${C.hm(t.finishedAt)}</td><td>${C.plate(t)}</td><td>${C.esc(t.supplier)}</td><td class="r m">${C.f2(c.netto)}</td><td class="r m ${t.w >= 10 ? 't-warn' : ''}">${C.f1(t.w)}</td><td class="r m">${C.f1(t.s)}</td><td class="r m">${C.f1(t.oil)}</td><td class="r m"><b>${C.f2(c.zach)}</b></td>
    <td>${t.sdiz === 'redeemed' ? `<span class="pill ok">№ …${t.sdizNo} погашен</span>` : can('sdiz') ? `<button class="btn" data-act="sdiz" data-id="${t.id}">Погасить …${t.sdizNo}</button>` : `<span class="pill neutral">№ …${t.sdizNo} не погашен</span>`}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">Нет рейсов по фильтру</td></tr>'}
  </tbody></table></div>`;
}

// ---------- Поставщики ----------
function suppliers() {
  const rows = S.suppliers.map((n) => {
    const d = C.done(S).filter((t) => t.supplier === n); let z = 0, w = 0, s = 0, o = 0;
    d.forEach((t) => { z += C.calc(t, S.cultures).zach; w += t.w; s += t.s; o += t.oil; });
    const k = d.length || 1, se = S.season.find((x) => x.name === n) || { cars: 0, zach: 0 };
    const q = !d.length ? '<span class="pill neutral">нет поставок</span>' : (w / k >= 9.5 || s / k >= 2.5) ? '<span class="pill warn">влажно, сорно</span>' : '<span class="pill ok">в норме</span>';
    return `<tr><td><b>${C.esc(n)}</b></td><td class="r m">${d.length}</td><td class="r m">${C.f1(z)}</td><td class="r m">${se.cars}</td><td class="r m">${C.f1(se.zach)}</td><td class="r m">${d.length ? C.f1(w / k) : '—'}</td><td class="r m">${d.length ? C.f1(s / k) : '—'}</td><td class="r m">${d.length ? C.f1(o / k) : '—'}</td><td>${q}</td></tr>`;
  }).join('');
  return `
  <div class="head"><div><h1>Поставщики</h1><p>Расчёты по зачётному весу · сезон 2026</p></div></div>
  <div class="table"><table><thead><tr><th>Хозяйство</th><th class="r">Машин сегодня</th><th class="r">Зачёт сегодня, т</th><th class="r">Машин за сезон</th><th class="r">Зачёт за сезон, т</th><th class="r">Влажн., %</th><th class="r">Сор, %</th><th class="r">Масличн., %</th><th>Качество</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="panel"><h2>Кабинет поставщика <span class="pill neutral">следующая версия</span></h2><p class="prose">Каждое хозяйство видит свои машины, анализы и зачётный вес по каждой поставке и сверяет расчёты без звонков на завод.</p></div>`;
}

// ---------- Базис ----------
let baseDraft = null; // черновик формы базиса
function settings() {
  const b = S.cultures.sun;
  const d = baseDraft || (baseDraft = { wb: String(b.wb).replace('.', ','), sb: String(b.sb).replace('.', ','), wetAlert: String(b.wetAlert).replace('.', ',') });
  const changed = ['wb', 'sb', 'wetAlert'].some((k) => num(d[k]) !== b[k]);
  return `
  <div class="head"><div><h1>Базис приёмки</h1><p>Подсолнечник · базисные показатели по договору с поставщиками</p></div></div>
  <div class="cols">
    <div class="panel"><h2>Базисные показатели</h2>
      <div class="base-form">
        <div class="field"><label for="b-wb">Базисная влажность, %</label><input id="b-wb" inputmode="decimal" data-base="wb" value="${C.esc(d.wb)}"></div>
        <div class="field"><label for="b-sb">Базисная сорная примесь, %</label><input id="b-sb" inputmode="decimal" data-base="sb" value="${C.esc(d.sb)}"></div>
        <div class="field"><label for="b-wet">Влажная партия — от, %</label><input id="b-wet" inputmode="decimal" data-base="wetAlert" value="${C.esc(d.wetAlert)}"></div>
      </div>
      <p class="note" style="margin:12px 0 14px">Новый базис применяется к рейсам, которые завершатся после сохранения. Завершённые рейсы остаются посчитанными по базису, действовавшему в момент приёмки.${S.baseChangedMs ? ` Последнее изменение: ${new Date(S.baseChangedMs).toLocaleDateString('ru-RU')} в ${C.ms2hm(S.baseChangedMs)}.` : ''}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" data-act="savebase" id="save-base" ${changed ? '' : 'disabled'}>Сохранить базис</button><button class="btn" data-act="resetbase" ${changed ? '' : 'disabled'}>Отменить</button></div>
    </div>
    <div class="calc" id="base-example">${baseExample(d)}</div>
  </div>
  <div class="panel"><h2>Как считается зачётный вес</h2>
    <p class="prose">Из физического веса сначала вычитается сорная примесь сверх базиса, затем влага сверх базиса. Скидка в процентах = (факт − базис) × 100 / (100 − базис). Если показатель ниже базиса, скидки нет.</p></div>`;
}
function baseExample(d) {
  const wb = num(d.wb), sb = num(d.sb);
  if (wb == null || sb == null) return '<p class="note">Введите базис, чтобы увидеть пример расчёта.</p>';
  const ex = { gross: 39.6, tare: 15.1, w: 9.6, s: 2.8, culture: 'sun' };
  const c = C.calc(ex, { sun: { wb, sb } });
  return `<div class="line"><span>Пример: нетто</span><b>${C.f2(c.netto)} т</b></div>
    <div class="line"><span>Влажность 9,6% → скидка</span><b>${C.f2(c.wd)}%</b></div>
    <div class="line"><span>Сорная примесь 2,8% → скидка</span><b>${C.f2(c.sd)}%</b></div>
    <div class="total"><span>Зачётный вес</span><b>${C.f2(c.zach)} т</b></div>
    <p class="note">Пример пересчитывается по мере ввода базиса.</p>`;
}

// ---------- Сотрудники (только руководитель) ----------
let nu = { name: '', phone: '', role: 'weigher' }; // форма нового сотрудника
let issued = null;                                  // выданный временный пароль — показываем один раз
const CAPS = [['Очередь, взвешивание, выгрузка', ['owner', 'weigher']], ['Анализ в лаборатории', ['owner', 'weigher', 'lab']], ['Журнал приёмки', ['owner', 'weigher', 'lab', 'accountant']],
  ['СДИЗ и выгрузка в 1С', ['owner', 'accountant']], ['Поставщики', ['owner', 'accountant']], ['Базис', ['owner']], ['Сотрудники и журнал действий', ['owner']], ['Приложение руководителя', ['owner']]];
function staff() {
  const users = S.users || [];
  return `
  <div class="head"><div><h1>Сотрудники</h1><p>Доступ к рабочему месту и приложению руководителя. Водители входят по SMS-коду, их здесь нет.</p></div></div>
  ${issued ? `<div class="calc"><div class="line"><span>Передайте сотруднику лично</span><b>${C.esc(issued.name)}</b></div>
    <div class="line"><span>Телефон для входа</span><b>${C.esc(C.phoneFmt(issued.phone))}</b></div>
    <div class="total"><span>Временный пароль</span><b>${C.esc(issued.password)}</b></div>
    <p class="note">Пароль показан один раз и нигде не хранится в открытом виде. <button class="btn-link" data-act="hideissued">Скрыть</button></p></div>` : ''}
  <div class="table"><table><thead><tr><th>Сотрудник</th><th>Телефон</th><th>Роль</th><th>Доступ</th><th></th></tr></thead><tbody>
  ${users.map((u) => { const self = u.id === S.me.id; return `<tr>
    <td><div class="user-chip"><span class="avatar">${C.esc(initials(u.name))}</span><div><b>${C.esc(u.name)}${self ? ' <span class="muted" style="font-weight:400">· вы</span>' : ''}</b><span class="muted" style="display:block;font-size:12px">${u.last_login_ms ? 'вход ' + new Date(u.last_login_ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' в ' + C.ms2hm(u.last_login_ms) : 'ещё не входил'}</span></div></div></td>
    <td class="m">${C.esc(C.phoneFmt(u.phone))}</td>
    <td>${self ? C.esc(S.roles[u.role]) : `<select class="role-select" data-role-for="${u.id}" aria-label="Роль: ${C.esc(u.name)}">${Object.entries(S.roles).map(([k, n]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${n}</option>`).join('')}</select>`}</td>
    <td>${u.active ? '<span class="pill ok">активен</span>' : '<span class="pill neutral">отключён</span>'}</td>
    <td class="r">${self ? '' : `<span class="row-actions"><button class="btn" data-act="resetpw" data-id="${u.id}">Новый пароль</button><button class="btn" data-act="toggleuser" data-id="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? 'Отключить' : 'Включить'}</button></span>`}</td></tr>`; }).join('')}
  </tbody></table></div>
  <div class="panel"><h2>Новый сотрудник</h2>
      <div class="new-user">
        <div class="field"><label for="nu-name">Имя и фамилия</label><input id="nu-name" data-nu="name" value="${C.esc(nu.name)}" autocomplete="off" style="font-family:var(--font)"></div>
        <div class="field"><label for="nu-phone">Телефон</label><input id="nu-phone" data-nu="phone" inputmode="tel" placeholder="+7 900 000-00-00" value="${C.esc(nu.phone)}" autocomplete="off"></div>
        <div class="field"><label for="nu-role">Роль</label><select id="nu-role" data-nu="role">${Object.entries(S.roles).map(([k, n]) => `<option value="${k}" ${k === nu.role ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <button class="btn btn-primary" data-act="adduser">Добавить</button>
      </div>
      <p class="note" style="margin:12px 0 0">Система выдаст временный пароль. Передайте его сотруднику лично, не в общем чате.</p>
    </div>
    <div class="panel"><h2>Права ролей</h2>
      <div class="table" style="border:0"><table><thead><tr><th></th>${Object.values(S.roles).map((n) => `<th>${n}</th>`).join('')}</tr></thead><tbody>
      ${CAPS.map(([cap, roles]) => `<tr><td>${cap}</td>${Object.keys(S.roles).map((r) => `<td>${roles.includes(r) ? '<span class="t-ok">✓</span>' : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>
  <div class="panel" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap"><div style="flex:1;min-width:220px"><h2 style="margin:0 0 4px">Сбросить демо</h2><p class="note">Вернуть исходную очередь, журнал и базис. Сотрудники и журнал действий сохранятся.</p></div><button class="btn" data-act="resetdemo">Сбросить</button></div>
  <div><p class="group-title">Журнал действий</p><div class="group">
    ${(S.audit || []).slice(0, 15).map((a) => `<div class="row"><span class="mono muted" style="width:44px">${C.ms2hm(a.at_ms)}</span><div class="main"><b>${C.esc(a.text)}</b><span>${C.esc(a.who)}</span></div></div>`).join('') || '<div class="empty">Пока пусто</div>'}
  </div></div>`;
}
const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// ---------- карточка рейса ----------
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
function sheet() {
  const t = S.trips.find((x) => x.id === openId); if (!t) return '';
  const dr = drafts[t.id] || (drafts[t.id] = { w: t.w ?? '', s: t.s ?? '', oil: t.oil ?? '' });
  const fin = t.status === 'done', labLocked = fin || t.status === 'unload' || !can('lab');
  const labOk = [dr.w, dr.s, dr.oil].every((v) => num(v) != null);
  const status = fin ? `<span class="pill ok">завершён ${C.hm(t.finishedAt)}</span>` : t.status === 'unload' ? '<span class="pill ok">выгрузка</span>' : '<span class="pill info">весовая</span>';
  // Вес вводится вручную с табло весов; пока машина на этом этапе — можно исправить
  const scale = (kind, val) => {
    const editable = can('queue') && !fin && (kind === 'gross' ? t.status === 'weigh' : t.status === 'unload');
    const key = `${t.id}:${kind}`, dv = weights[key] ?? (val != null ? C.f2(val) : '');
    const label = `Весы №1 · ${kind === 'gross' ? 'брутто' : 'тара'}${editable ? ' · введите с табло' : ''}`;
    if (!editable) return `<div class="dark-panel scale"><div><div class="lbl">${label}</div><div class="v ${val == null ? 'pending' : ''}">${val != null ? C.f2(val) : '—'}<small>т</small></div></div>
      <div class="end">${val != null ? '<span class="ok">записано</span>' : ''}</div></div>`;
    const changed = num(dv) != null && num(dv) !== val;
    return `<div class="dark-panel scale"><div style="flex:1;min-width:0"><label class="lbl" for="wt-${kind}">${label}</label>
      <div class="v-input"><input id="wt-${kind}" class="v" inputmode="decimal" autocomplete="off" data-weight="${kind}" value="${C.esc(dv)}" placeholder="00,00"><small>т</small></div></div>
      <div class="end">${val != null && !changed ? '<span class="ok">записано</span>' : `<button class="btn btn-primary" data-act="saveweight" data-kind="${kind}" id="save-${kind}" ${num(dv) == null ? 'disabled' : ''}>${val != null ? 'Исправить' : 'Записать'}</button>`}</div></div>`;
  };
  return `<div class="scrim" data-close><aside class="sheet" role="dialog" aria-modal="true" aria-label="Рейс">
    <div class="sheet-head"><div class="top">${C.plate(t, true)}${status}<button class="btn" data-close>Закрыть</button></div>
      <div class="sub">${C.esc(t.supplier)} · подсолнечник · приехал ${C.hm(t.arrivedAt)} · СДИЗ №…${t.sdizNo}</div></div>
    <div class="sheet-body">
      <div><p class="group-title">1 · Брутто</p>${scale('gross', t.gross)}</div>
      <div class="${t.gross == null ? 'locked' : ''}"><p class="group-title">2 · Лаборатория, %</p><div class="group"><div class="fields3">
        <div class="field"><label for="f-w">Влажность</label><input id="f-w" inputmode="decimal" data-draft="w" value="${C.esc(dr.w)}" placeholder="8,0" ${labLocked ? 'disabled' : ''}></div>
        <div class="field"><label for="f-s">Сорная примесь</label><input id="f-s" inputmode="decimal" data-draft="s" value="${C.esc(dr.s)}" placeholder="1,5" ${labLocked ? 'disabled' : ''}></div>
        <div class="field"><label for="f-o">Масличность</label><input id="f-o" inputmode="decimal" data-draft="oil" value="${C.esc(dr.oil)}" placeholder="49,0" ${labLocked ? 'disabled' : ''}></div>
      </div></div>
      ${t.status === 'weigh' && can('queue') ? `<div style="margin-top:12px"><button class="btn btn-dark btn-lg" data-act="tounload" id="to-unload" ${t.gross != null && labOk ? '' : 'disabled'}>Отправить на выгрузку · яма №2</button></div>` : ''}
      ${t.status === 'weigh' && !can('queue') && can('lab') ? `<div style="margin-top:12px"><button class="btn btn-dark btn-lg" data-act="savelab" id="to-unload" ${t.gross != null && labOk ? '' : 'disabled'}>Сохранить анализ</button></div>` : ''}</div>
      <div class="${t.status === 'weigh' ? 'locked' : ''}"><p class="group-title">3 · Тара после выгрузки</p>${scale('tare', t.tare)}</div>
      <div class="calc" id="calc">${calcHtml(t)}</div>
      ${t.status === 'unload' && can('queue') ? `<button class="btn btn-primary btn-lg" data-act="finish" ${t.tare == null ? 'disabled' : ''}>Завершить рейс и отправить акт</button>` : ''}
    </div></aside></div>`;
}
function calcHtml(t) {
  const dr = drafts[t.id] || {};
  const c = C.calc(t, S.cultures, { w: num(dr.w), s: num(dr.s) });
  return `<div class="line"><span>Нетто (брутто − тара)</span><b>${c.netto != null ? C.f2(c.netto) + ' т' : 'после тары'}</b></div>
    <div class="line"><span>Скидка на сорную примесь, базис ${c.c.sb}%</span><b>${c.sd != null ? C.f2(c.sd) + '%' : '—'}</b></div>
    <div class="line"><span>Скидка на влажность, базис ${c.c.wb}%</span><b>${c.wd != null ? C.f2(c.wd) + '%' : '—'}</b></div>
    <div class="total"><span>Зачётный вес</span><b>${c.zach != null ? C.f2(c.zach) + ' т' : '—'}</b></div>
    <p class="note">${c.zach != null ? `К оплате ${C.f2(c.zach)} т из ${C.f2(c.netto)} т. Разница — вода и сор сверх базиса.` : 'Считается сам, когда есть тара и анализ. Скидка = (факт − базис) × 100 / (100 − базис).'}</p>`;
}

// ---------- отрисовка ----------
const VIEWS = { summary, queue, journal, suppliers, settings, staff };
function render() {
  if (!S) return;
  const q = C.waiting(S).length, allowed = ROLE_PAGES[S.me.role];
  if (!allowed.includes(page)) page = allowed[0];
  document.getElementById('nav').innerHTML = PAGES.filter(([k]) => allowed.includes(k)).map(([k, n, ic]) => `<button data-page="${k}" ${page === k ? 'aria-current="page"' : ''}>${C.icon[ic]}${n}${k === 'queue' && q ? `<span class="cnt">${q}</span>` : ''}</button>`).join('');
  document.getElementById('clock').textContent = C.hm(S.now);
  const ae = document.activeElement;
  // пока вводят базис, не перерисовываем форму — чтобы не сбить курсор
  const typing = ae && ae.dataset && ((page === 'settings' && ae.dataset.base) || (page === 'staff' && ae.dataset.nu));
  if (!typing) document.getElementById('page').innerHTML = VIEWS[page]();
  document.getElementById('user').innerHTML = `<div class="user-chip"><span class="avatar">${C.esc(initials(S.me.name))}</span><div><b>${C.esc(S.me.name)}</b><span>${C.esc(S.me.roleName)}</span></div><button class="icon-btn out" data-act="logout" aria-label="Выйти" title="Выйти">${C.icon.logout}</button></div>`;
  renderSheet();
}
function renderSheet(force) {
  const box = document.getElementById('sheet');
  // не перерисовываем карточку, пока в ней вводят анализ — чтобы не сбить курсор
  if (!force && box.contains(document.activeElement) && document.activeElement.matches('input')) return;
  box.innerHTML = openId ? sheet() : '';
}

// ---------- события ----------
document.addEventListener('click', async (e) => {
  const pg = e.target.closest('[data-page]');
  if (pg) { baseDraft = null; page = pg.dataset.page; C.store.set('desk.page', page); openId = null; render(); return; }
  const pr = e.target.closest('[data-period]');
  if (pr) { period = pr.dataset.period; render(); return; }
  const fl = e.target.closest('[data-filter]');
  if (fl) { filter = fl.dataset.filter; render(); return; }
  if (e.target.matches('[data-close]')) { openId = null; renderSheet(true); return; }
  const el = e.target.closest('[data-act]');
  const op = e.target.closest('[data-open]');
  if (op && !el) { openId = Number(op.dataset.open); renderSheet(true); return; }
  if (!el || el.disabled) return;
  const a = el.dataset.act, id = Number(el.dataset.id) || openId;
  try {
    if (a === 'invite') { await C.act('invite', { id }); C.toast('Водителю отправлено: «Проезжайте на весовую №1»'); }
    if (a === 'next') { await C.act('next'); C.toast('Следующая машина приглашена на весовую'); }
    if (a === 'arrive') { await C.act('arrive', { id }); }
    if (a === 'sdiz') { await C.act('sdiz', { id }); C.toast('СДИЗ отмечен погашенным. В рабочей версии — отправка во ФГИС «Зерно»'); }
    if (a === 'export') { const st = C.stats(S); C.toast(`Файл для 1С: ${st.count} рейсов, ${C.f1(st.zach)} т. В демо файл не создаётся`); }
    if (a === 'saveweight') {
      const kind = el.dataset.kind, key = `${id}:${kind}`;
      await C.act('weigh', { id, kind, value: num(weights[key]) });
      delete weights[key]; document.activeElement.blur(); renderSheet(true); C.toast(kind === 'gross' ? 'Брутто записано' : 'Тара записана');
    }
    if (a === 'tounload') {
      const dr = drafts[id];
      await C.act('lab', { id, w: num(dr.w), s: num(dr.s), oil: num(dr.oil) });
      await C.act('tounload', { id }); C.toast('Водителю отправлено: «Выгрузка, завальная яма №2»');
    }
    if (a === 'savebase') {
      const d = baseDraft; await C.act('setBase', { wb: num(d.wb), sb: num(d.sb), wetAlert: num(d.wetAlert) });
      baseDraft = null; document.activeElement.blur(); render(); C.toast('Базис сохранён. Применяется к новым рейсам');
    }
    if (a === 'resetbase') { baseDraft = null; render(); }
    if (a === 'savelab') {
      const dr = drafts[id]; await C.act('lab', { id, w: num(dr.w), s: num(dr.s), oil: num(dr.oil) }); C.toast('Анализ сохранён. Весовщик отправит машину на выгрузку');
    }
    if (a === 'logout') { await C.logout(); }
    if (a === 'resetdemo') { await C.act('reset'); drafts && Object.keys(drafts).forEach((k) => delete drafts[k]); C.toast('Демо сброшено к исходным данным'); }
    if (a === 'hideissued') { issued = null; render(); }
    if (a === 'adduser') {
      const r = await C.act('userCreate', { ...nu });
      issued = { name: nu.name, phone: nu.phone.replace(/\D/g, '').replace(/^8/, '7'), password: r.tempPassword };
      nu = { name: '', phone: '', role: 'weigher' }; render(); C.toast('Сотрудник добавлен');
    }
    if (a === 'resetpw') {
      const u = S.users.find((x) => x.id === id); const r = await C.act('userResetPassword', { id });
      issued = { name: u.name, phone: u.phone, password: r.tempPassword }; render(); C.toast('Пароль сброшен, сотрудник вышел со всех устройств');
    }
    if (a === 'toggleuser') { await C.act('userUpdate', { id, active: el.dataset.active === '1' }); C.toast(el.dataset.active === '1' ? 'Доступ включён' : 'Доступ отключён, сотрудник вышел со всех устройств'); }
    if (a === 'finish') { await C.act('finish', { id }); C.toast('Рейс завершён, акт отправлен водителю и в хозяйство'); }
  } catch { renderSheet(true); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.weight) { e.preventDefault(); document.getElementById(`save-${e.target.dataset.weight}`)?.click(); return; }
  if (e.key === 'Escape' && openId) { openId = null; renderSheet(true); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('change', async (e) => {
  const rf = e.target.dataset.roleFor;
  if (rf) { try { await C.act('userUpdate', { id: Number(rf), role: e.target.value }); C.toast('Роль изменена. Сотрудник войдёт заново'); } catch { render(); } }
  if (e.target.dataset.nu === 'role') nu.role = e.target.value;
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.nu) { nu[e.target.dataset.nu] = e.target.value; return; }
  const bk = e.target.dataset.base;
  if (bk && baseDraft) {
    baseDraft[bk] = e.target.value;
    document.getElementById('base-example').innerHTML = baseExample(baseDraft);
    const b = S.cultures.sun, changed = ['wb', 'sb', 'wetAlert'].some((k) => num(baseDraft[k]) !== b[k]);
    document.getElementById('save-base').disabled = !changed; document.querySelector('[data-act="resetbase"]').disabled = !changed;
    return;
  }
  const wk = e.target.dataset.weight;
  if (wk && openId) {
    weights[`${openId}:${wk}`] = e.target.value;
    const t = S.trips.find((x) => x.id === openId), b = document.getElementById(`save-${wk}`);
    if (b) b.disabled = num(e.target.value) == null;
    else if (num(e.target.value) !== t[wk]) { renderSheet(true); const i = document.getElementById(`wt-${wk}`); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    return;
  }
  const k = e.target.dataset.draft; if (!k || !openId) return;
  drafts[openId][k] = e.target.value;
  const t = S.trips.find((x) => x.id === openId), dr = drafts[openId];
  document.getElementById('calc').innerHTML = calcHtml(t);
  const b = document.getElementById('to-unload'); if (b) b.disabled = !(t.gross != null && [dr.w, dr.s, dr.oil].every((v) => num(v) != null));
});

(async () => {
  await C.requireAuth({ kind: 'staff', app: 'рабочее место' }); // без входа дальше не идём
  document.getElementById('mark').innerHTML = C.icon.seed;
  C.live((st) => { S = st; render(); }, (ok) => {
    document.getElementById('conn').innerHTML = ok ? '<span class="dot ok"></span>онлайн' : '<span class="dot crit"></span>нет связи';
  });
})();
