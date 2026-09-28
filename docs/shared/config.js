// Куда ходить за данными. На GitHub Pages — HTTPS-туннель ngrok к серверу на ПК.
// Локально (сайт открыт с самого сервера) — тот же адрес, поэтому пусто.
// Адрес туннеля подставляется командой: npm run set-api -- https://ВАШ-ДОМЕН.ngrok-free.app
window.PRIEMKA_API = location.hostname.endsWith('github.io') ? 'https://kandis-nondenunciating-uncleanly.ngrok-free.dev' : '';
