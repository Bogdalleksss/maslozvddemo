// Подставляет адрес туннеля ngrok в docs/shared/config.js (для версии на GitHub Pages).
// Запуск: npm run set-api -- https://ВАШ-ДОМЕН.ngrok-free.app
const fs = require('fs');
const path = require('path');
const url = process.argv[2];
if (!/^https:\/\/[a-z0-9.-]+$/i.test(url || '')) { console.error('Укажите адрес вида https://имя.ngrok-free.app'); process.exit(1); }
const file = path.join(__dirname, '..', 'docs', 'shared', 'config.js');
const src = fs.readFileSync(file, 'utf8').replace(/'https:\/\/[^']*'/, `'${url}'`);
fs.writeFileSync(file, src);
// меняем номер версии в подключении config.js, чтобы браузеры не взяли старый адрес из кеша
const docs = path.join(__dirname, '..', 'docs');
for (const f of ['index.html', 'desk/index.html', 'owner/index.html', 'driver/index.html']) {
  const p = path.join(docs, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/shared\/config\.js(\?v=\d+)?"/, (m, v) => `shared/config.js?v=${(v ? Number(v.slice(3)) : 1) + 1}"`));
}
console.log('API для GitHub Pages:', url);
