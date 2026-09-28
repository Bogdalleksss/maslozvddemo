// Генерирует иконки приложения из логотипа «семечка» (янтарный квадрат + контур семечки).
// Без сторонних библиотек: рисуем попиксельно со сглаживанием и кодируем PNG через zlib.
// Запуск: npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'docs', 'icons');
const AMBER = [0xE0, 0xA1, 0x06], INK = [0x2A, 0x1F, 0x00], DARK = [0x18, 0x22, 0x1D];

// Контур семечки из SVG-логотипа (viewBox 24×24): M12 3 c3.5 3 5 6 5 9.5 A5 5 0 0 1 12 18 A5 5 0 0 1 7 12.5 C7 9 8.5 6 12 3 z; M12 18 v3
function seedPolyline() {
  const pts = [];
  const cubic = (p0, p1, p2, p3) => { for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } };
  cubic([12, 3], [15.5, 6], [17, 9], [17, 12.5]);
  // нижняя дуга: полуокружность радиуса 5 с центром (12, 12.8) от (17,12.5) через низ к (7,12.5)
  for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI; pts.push([12 + 5 * Math.cos(a), 12.8 + 5.2 * Math.sin(a)]); }
  cubic([7, 12.5], [7, 9], [8.5, 6], [12, 3]);
  return pts;
}
const SEED = seedPolyline();
const STEM = [[12, 18], [12, 21]];

function distToSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px, y = ay + t * dy - py; return Math.sqrt(x * x + y * y);
}
function inRoundRect(x, y, s, r) { // квадрат s×s со скруглением r
  const cx = Math.min(Math.max(x, r), s - r), cy = Math.min(Math.max(y, r), s - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Рисуем иконку size×size. pad — поле вокруг (для maskable/значка), full — фон на весь квадрат без скругления
function draw(size, { radius = 0.22, pad = 0, full = false, bg = AMBER, fg = INK, stroke = 2.2 } = {}) {
  const SS = 4; // сглаживание: 4×4 подвыборки на пиксель
  const px = Buffer.alloc(size * size * 4);
  const inner = size * (1 - 2 * pad), off = size * pad, scale = inner / 24;
  const glyphScale = scale * 0.62, glyphOff = off + (inner - 24 * glyphScale) / 2; // логотип занимает ~62% квадрата
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bgHits = 0, fgHits = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + 0.5) / SS, Y = y + (sy + 0.5) / SS;
      const inBg = full || inRoundRect(X - off, Y - off, inner, inner * radius);
      if (!inBg) continue;
      bgHits++;
      const gx = (X - glyphOff) / glyphScale, gy = (Y - glyphOff) / glyphScale;
      let d = Infinity;
      for (let i = 0; i < SEED.length - 1; i++) d = Math.min(d, distToSeg(gx, gy, SEED[i], SEED[i + 1]));
      d = Math.min(d, distToSeg(gx, gy, STEM[0], STEM[1]));
      if (d <= stroke / 2) fgHits++;
    }
    const n = SS * SS, a = bgHits / n, f = bgHits ? fgHits / bgHits : 0, i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(bg[c] * (1 - f) + fg[c] * f);
    px[i + 3] = Math.round(a * 255);
  }
  return png(size, size, px);
}

function png(w, h, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'favicon-32.png': draw(32, { stroke: 2.6 }),
  'apple-touch-icon.png': draw(180, { full: true }),      // iOS сам скругляет углы
  'icon-192.png': draw(192),
  'icon-512.png': draw(512),
  'icon-maskable-512.png': draw(512, { full: true, pad: 0.1 }), // Android обрезает по своей маске — логотип в безопасной зоне
};
for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), buf);
// SVG-фавикон — векторный логотип для браузеров на компьютере
fs.writeFileSync(path.join(OUT, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#E0A106"/><g transform="translate(4.6 4.6) scale(0.95)" fill="none" stroke="#2A1F00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3.5 3 5 6 5 9.5A5 5 0 0 1 12 18a5 5 0 0 1-5-5.5C7 9 8.5 6 12 3z"/><path d="M12 18v3"/></g></svg>\n`);
console.log('Иконки:', Object.keys(files).concat('favicon.svg').join(', '));
