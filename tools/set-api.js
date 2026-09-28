// Подставляет адрес туннеля ngrok в docs/shared/config.js (для версии на GitHub Pages).
// Запуск: npm run set-api -- https://ВАШ-ДОМЕН.ngrok-free.app
const fs = require('fs');
const path = require('path');
const url = process.argv[2];
if (!/^https:\/\/[a-z0-9.-]+$/i.test(url || '')) { console.error('Укажите адрес вида https://имя.ngrok-free.app'); process.exit(1); }
const file = path.join(__dirname, '..', 'docs', 'shared', 'config.js');
const src = fs.readFileSync(file, 'utf8').replace(/'https:\/\/[^']*'/, `'${url}'`);
fs.writeFileSync(file, src);
console.log('API для GitHub Pages:', url);
