// Главная страница демо: статус сервера и демо-доступы
document.getElementById('mark').innerHTML = Core.icon.seed;
(async () => {
  const box = document.getElementById('server');
  const { status, data } = await Core.request('/api/info');
  if (status !== 200) {
    box.innerHTML = '<b><span class="dot crit"></span>Сервер демо выключен</b><span>Запустите его на компьютере: npm start и npm run tunnel</span>';
    return;
  }
  box.innerHTML = '<b><span class="dot ok"></span>Сервер демо работает</b><span>Данные и уведомления идут с компьютера, на котором запущено демо</span>';
  const d = data.demo;
  document.getElementById('demo').innerHTML = d.staff.map((u) => `<div class="row"><div class="main"><b>${Core.esc(u.roleName)} · ${Core.esc(u.name)}</b><span>${Core.esc(Core.phoneFmt(u.phone))} · пароль ${Core.esc(d.password)}</span></div></div>`)
    .concat(d.drivers.map((p, i) => `<div class="row"><div class="main"><b>Водитель · ${i === 0 ? 'К 482 МР' : 'Р 559 УК'}</b><span>${Core.esc(Core.phoneFmt(p))} · код из SMS показывается на экране</span></div></div>`)).join('');
})();
