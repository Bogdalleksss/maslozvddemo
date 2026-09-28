// Общая логика трёх сайтов: форматирование, расчёт зачётного веса, связь с сервером.
window.Core = (() => {
  const f1 = (n) => n == null || isNaN(n) ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const f2 = (n) => n == null || isNaN(n) ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hm = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const dur = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} ч ${r} мин` : `${r} мин`; };
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plate = (t, lg) => `<span class="plate${lg ? ' lg' : ''}" aria-label="Госномер ${esc(t.plate)} ${esc(t.region)}"><span class="n">${esc(t.plate[0])} ${esc(t.plate.slice(1, 4))} ${esc(t.plate.slice(4))}</span><span class="r">${esc(t.region)}</span></span>`;
  const plateText = (t) => `${t.plate[0]} ${t.plate.slice(1, 4)} ${t.plate.slice(4)}`;

  // Зачётный вес: из нетто вычитается сор сверх базиса, затем влага сверх базиса.
  // Скидка, % = (факт − базис) × 100 / (100 − базис)
  function calc(t, cultures, draft) {
    // у завершённого рейса — базис, по которому его приняли; у текущих — действующий
    const c = t.base ? { ...cultures[t.culture], ...t.base } : cultures[t.culture];
    const w = draft?.w ?? t.w, s = draft?.s ?? t.s;
    const netto = t.gross != null && t.tare != null ? t.gross - t.tare : null;
    const sd = s != null ? Math.max(0, s - c.sb) * 100 / (100 - c.sb) : null;
    const wd = w != null ? Math.max(0, w - c.wb) * 100 / (100 - c.wb) : null;
    const zach = netto != null && sd != null && wd != null ? netto * (1 - sd / 100) * (1 - wd / 100) : null;
    return { netto, sd, wd, zach, c };
  }

  const by = (S, st) => S.trips.filter((t) => t.status === st);
  const waiting = (S) => by(S, 'arrived').sort((a, b) => a.arrivedAt - b.arrivedAt);
  const done = (S) => by(S, 'done').filter((t) => !S.today || t.day === S.today).sort((a, b) => b.finishedAt - a.finishedAt); // сегодня
  const doneAll = (S) => by(S, 'done').sort((a, b) => (a.day === b.day ? b.finishedAt - a.finishedAt : a.day < b.day ? 1 : -1));
  const ms2hm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  const dayLabel = (S, d) => (d === S.today ? 'сегодня' : d === S.yesterday ? 'вчера' : new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));

  function stats(S) {
    const d = done(S); let netto = 0, zach = 0, oil = 0, stay = 0;
    d.forEach((t) => { const c = calc(t, S.cultures); netto += c.netto; zach += c.zach; oil += t.oil; stay += t.finishedAt - t.arrivedAt; });
    const q = waiting(S);
    return {
      count: d.length, netto, zach, disc: netto ? (netto - zach) / netto * 100 : 0, oil: d.length ? oil / d.length : 0,
      stay: d.length ? stay / d.length : 0, queue: q.length, longest: q.length ? S.now - q[0].arrivedAt : 0,
      inWork: by(S, 'weigh').length + by(S, 'unload').length, booked: by(S, 'booked').length,
      sdizPending: d.filter((t) => t.sdiz === 'pending').length,
    };
  }

  function alerts(S) {
    const out = [];
    waiting(S).forEach((t) => { const m = S.now - t.arrivedAt; if (m >= 90) out.push({ lvl: 'crit', id: t.id, title: `${plateText(t)} ждёт ${dur(m)}`, sub: `${t.supplier} · норматив 90 мин` }); });
    const wet = S.cultures.sun.wetAlert ?? 10;
    const wetList = done(S).filter((t) => t.w >= wet).sort((a, b) => b.w - a.w);
    if (wetList.length === 1) { const t = wetList[0]; out.push({ lvl: 'warn', title: `Влажная партия, ${f1(t.w)}%`, sub: `${t.supplier} · ${hm(t.finishedAt)} · на сушку` }); }
    if (wetList.length > 1) { const t = wetList[0]; out.push({ lvl: 'warn', title: `${wetList.length} ${plural(wetList.length, 'влажная партия', 'влажные партии', 'влажных партий')}, от ${f1(wet)}%`, sub: `Самая влажная: ${f1(t.w)}%, ${t.supplier} · на сушку` }); }
    const st = stats(S); if (st.sdizPending) out.push({ lvl: 'accent', title: `${st.sdizPending} СДИЗ ждут погашения`, sub: 'ФГИС «Зерно» · журнал приёмки', go: 'journal' });
    return out;
  }

  function hourly(S) {
    const last = Math.max(14, Math.floor(S.now / 60)); const hours = [];
    for (let h = 6; h <= last; h++) hours.push({ h, v: 0 });
    done(S).forEach((t) => { const b = hours.find((x) => x.h === Math.floor(t.finishedAt / 60)); if (b) b.v += calc(t, S.cultures).zach; });
    return hours;
  }

  function chart(S, { width = 640, height = 200 } = {}) {
    const data = hourly(S), pl = 30, pr = 4, pt = 10, pb = 22;
    const max = Math.max(40, Math.ceil(Math.max(...data.map((d) => d.v)) / 20) * 20);
    const bw = (width - pl - pr) / data.length, y = (v) => pt + (height - pt - pb) * (1 - v / max);
    const cur = Math.floor(S.now / 60); let g = '';
    for (let v = 0; v <= max; v += max / 2) g += `<line class="gridline" x1="${pl}" x2="${width - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
    data.forEach((d, i) => {
      const x = pl + i * bw + bw * 0.22, w = bw * 0.56;
      if (d.v > 0) g += `<rect class="bar${d.h === cur ? '' : ' dim'}" x="${x}" y="${y(d.v)}" width="${w}" height="${y(0) - y(d.v)}" rx="4"><title>${d.h}:00 — ${f1(d.v)} т</title></rect>`;
      g += `<text class="axis" x="${x + w / 2}" y="${height - 5}" text-anchor="middle">${d.h}</text>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Приёмка по часам, тонн зачётного веса">${g}</svg></div>`;
  }

  // ---- связь с сервером ----
  // Адрес API: на GitHub Pages — туннель к серверу на ПК (config.js), локально — тот же сервер.
  const API = (window.PRIEMKA_API || '').replace(/\/$/, '');
  let APP = 'staff'; // чьё это приложение: staff или driver — у них разные входы
  const tokenKey = () => 'priemka.token.' + APP;
  // Токен хранится в браузере: сайт и сервер на разных доменах, а Safari блокирует cookie между сайтами.
  // Компенсация: строгая CSP без встроенных скриптов, в базе только хеш токена, срок жизни 12 ч, отзыв на сервере.
  const getToken = () => store.get(tokenKey());
  const setToken = (t) => { try { t ? localStorage.setItem(tokenKey(), t) : localStorage.removeItem(tokenKey()); } catch { /* приватный режим */ } };
  const headers = (extra) => ({ 'X-App': APP, 'ngrok-skip-browser-warning': '1', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}), ...extra });
  async function request(path, { method = 'GET', body } = {}) {
    try {
      const r = await fetch(API + path, { method, headers: headers(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      const data = await r.json().catch(() => ({ ok: false, error: 'Сервер ответил неожиданно' }));
      return { status: r.status, data };
    } catch { return { status: 0, data: { ok: false, error: 'Сервер демо недоступен. Проверьте, что он запущен на компьютере' } }; }
  }
  async function post(path, body) {
    const { status, data } = await request(path, { method: 'POST', body: body || {} });
    if (status === 401 && path === '/api/action') { setToken(null); location.reload(); }
    return data;
  }
  async function act(type, payload = {}) {
    const data = await post('/api/action', { type, ...payload });
    if (!data.ok) { toast(data.error || 'Не получилось', true); throw new Error(data.error); }
    return data;
  }

  // Живые обновления: поток событий через fetch (EventSource не умеет передавать заголовки авторизации)
  function live(onState, onConn) {
    let stopped = false;
    const open = async () => {
      try {
        const r = await fetch(API + '/api/events?app=' + APP, { headers: headers({ Accept: 'text/event-stream' }) });
        if (r.status === 401) { setToken(null); return location.reload(); }
        if (!r.ok || !r.body) throw new Error('stream');
        onConn && onConn(true);
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            if (/^event: logout/m.test(chunk)) { setToken(null); return location.reload(); } // доступ отключили или сессия истекла
            const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
            if (data) onState(JSON.parse(data));
          }
        }
      } catch { /* обрыв — переподключимся */ }
      onConn && onConn(false);
      if (!stopped) setTimeout(open, 2500);
    };
    open();
    return () => { stopped = true; };
  }

  // ---- вход ----
  const phoneFmt = (d) => { d = String(d).replace(/\D/g, ''); return d.length === 11 ? `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : d; };
  async function logout() { await post('/api/logout'); setToken(null); location.reload(); }

  // Проверяет вход; если не вошли или роль не подходит — показывает экран входа. Возвращает профиль.
  async function requireAuth({ kind, roles, app }) {
    APP = kind;
    const { status, data } = await request('/api/me');
    if (status === 0) { renderOffline(app); return new Promise(() => {}); }
    const me = data && data.me;
    if (me && me.kind === kind && (!roles || roles.includes(me.role))) return me;
    if (status === 401) setToken(null);
    renderLogin({ kind, app, denied: me || null });
    return new Promise(() => {}); // дальше страница не грузится, пока не войдут
  }
  function renderOffline(app) {
    document.body.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-brand"><span class="mark">${icon.seed}</span><div><b>Приёмка</b><span>Маслозавод «Пример» · ${esc(app)}</span></div></div>
      <h1>Сервер демо выключен</h1><p class="muted">Данные и уведомления идут с компьютера, на котором запущено демо. Попросите включить его или попробуйте позже.</p>
      <button class="btn btn-primary btn-lg" id="retry">Повторить</button></div></div>`;
    document.getElementById('retry').onclick = () => location.reload();
  }

  async function renderLogin({ kind, app, denied }) {
    const demo = (await request('/api/info')).data.demo || {};
    const root = document.createElement('div');
    root.className = 'auth';
    document.body.innerHTML = ''; document.body.appendChild(root);
    const head = `<div class="auth-brand"><span class="mark">${icon.seed}</span><div><b>Приёмка</b><span>Маслозавод «Пример» · ${esc(app)}</span></div>${themeButton()}</div>`;

    if (denied) {
      root.innerHTML = `<div class="auth-card">${head}<h1>Нет доступа</h1><p class="muted">${esc(denied.name)}, роль «${esc(denied.roleName)}» не даёт доступа к этому разделу. Обратитесь к руководителю.</p>
        <button class="btn btn-lg" id="out">Войти под другим пользователем</button></div>`;
      root.querySelector('#out').onclick = logout; paintThemeButtons(); return;
    }

    if (kind === 'staff') {
      root.innerHTML = `<form class="auth-card" id="f" novalidate>${head}<h1>Вход</h1>
        <div class="field"><label for="ph">Телефон</label><input id="ph" name="phone" inputmode="tel" autocomplete="username" placeholder="+7 900 000-00-00" required></div>
        <div class="field"><label for="pw">Пароль</label><input id="pw" name="password" type="password" autocomplete="current-password" required></div>
        <p class="auth-err" id="err" role="alert"></p>
        <button class="btn btn-primary btn-lg" type="submit">Войти</button>
        ${demo.staff ? `<div class="auth-demo"><p class="group-title">Демо-доступы · пароль ${esc(demo.password)}</p><div class="auth-chips">${demo.staff.map((u) => `<button type="button" class="chip-btn" data-ph="${esc(u.phone)}"><b>${esc(u.roleName)}</b><span>${esc(u.name)}</span></button>`).join('')}</div></div>` : ''}
      </form>`;
      root.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => { root.querySelector('#ph').value = phoneFmt(b.dataset.ph); root.querySelector('#pw').value = demo.password; root.querySelector('#pw').focus(); });
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const d = await post('/api/login', { phone: root.querySelector('#ph').value, password: root.querySelector('#pw').value });
        if (d.ok) { setToken(d.token); location.reload(); } else root.querySelector('#err').textContent = d.error;
      };
    } else {
      root.innerHTML = `<form class="auth-card" id="f" novalidate>${head}<h1>Вход для водителя</h1><p class="muted">Код придёт в SMS на ваш номер.</p>
        <div class="field"><label for="ph">Телефон</label><input id="ph" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00"></div>
        <div class="field hidden-f" id="codef"><label for="code">Код из SMS</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="0000"></div>
        <p class="auth-hint" id="hint"></p><p class="auth-err" id="err" role="alert"></p>
        <button class="btn btn-primary btn-lg" type="submit" id="go">Получить код</button>
        ${demo.drivers ? `<div class="auth-demo"><p class="group-title">Демо-водители</p><div class="auth-chips">${demo.drivers.map((p, i) => `<button type="button" class="chip-btn" data-ph="${esc(p)}"><b>${i === 0 ? 'К 482 МР' : 'Р 559 УК'}</b><span>${esc(phoneFmt(p))}</span></button>`).join('')}</div></div>` : ''}
      </form>`;
      let step = 'phone';
      root.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => { root.querySelector('#ph').value = phoneFmt(b.dataset.ph); });
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault(); const err = root.querySelector('#err'); err.textContent = '';
        const phone = root.querySelector('#ph').value;
        if (step === 'phone') {
          const d = await post('/api/driver/code', { phone });
          if (!d.ok) { err.textContent = d.error; return; }
          step = 'code'; root.querySelector('#codef').classList.remove('hidden-f'); root.querySelector('#go').textContent = 'Войти';
          root.querySelector('#hint').textContent = d.demoCode ? `Демо: SMS не отправляется, ваш код ${d.demoCode}` : 'Код отправлен';
          root.querySelector('#code').focus();
        } else {
          const d = await post('/api/driver/login', { phone, code: root.querySelector('#code').value });
          if (d.ok) { setToken(d.token); location.reload(); } else err.textContent = d.error;
        }
      };
    }
    paintThemeButtons();
  }

  function toast(msg, err) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.setAttribute('role', err ? 'alert' : 'status');
    const ic = err
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
    el.innerHTML = `<span class="ic">${ic}</span><span class="tx"></span><button class="x" aria-label="Закрыть">×</button>`;
    el.querySelector('.tx').textContent = msg;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    el.querySelector('.x').addEventListener('click', close);
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(close, err ? 7000 : 5500);
  }

  // ---- тема: светлая / тёмная, выбор запоминается ----
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  function paintThemeButtons() {
    // цвет панели браузера и строки статуса на телефоне — как фон страницы
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      b.innerHTML = isDark() ? SUN : MOON;
      b.setAttribute('aria-label', isDark() ? 'Светлая тема' : 'Тёмная тема'); b.title = b.getAttribute('aria-label');
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store.set('theme', next); paintThemeButtons();
  });
  const themeButton = () => '<button class="icon-btn" data-theme-toggle type="button"></button>';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

  const icon = {
    seed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3.5 3 5 6 5 9.5A5 5 0 0 1 12 18a5 5 0 0 1-5-5.5C7 9 8.5 6 12 3z"/><path d="M12 18v3"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5 12 4l8.5 6.5V20H3.5z"/><path d="M9.5 20v-5.5h5V20"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5h11.5v9H2.5zM14 9.5h4l3.5 3.5v2.5H14z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="10" r="2.6"/><path d="M7.5 17c.8-2 2.5-3 4.5-3s3.7 1 4.5 3"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.3"/><path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5"/><path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4M17.5 14.6c1.8.7 3 2.4 3.5 4.9"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="8.5" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11.5M9 12h11.5M9 18h11.5M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  };

  setTimeout(paintThemeButtons);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButtons);
  return { API, request, requireAuth, logout, doneAll, ms2hm, dayLabel, phoneFmt, themeButton, paintThemeButtons, f1, f2, hm, dur, esc, plate, plateText, calc, by, waiting, done, stats, alerts, chart, act, live, toast, store, icon };
})();
