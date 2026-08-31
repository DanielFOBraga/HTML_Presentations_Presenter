/**
 * Gera build/icon.png (256x256, RGBA) — dois "ecrãs": o slide grande e o
 * seguinte ao lado, que é o que a app faz. Desenhado a 4x e reduzido, para as
 * bordas ficarem suaves.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SS = 4;                 // supersampling
const W = SIZE * SS;

const buf = new Uint8ClampedArray(W * W * 4); // RGBA a 4x

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function roundRect(x0, y0, x1, y1, r, color, alpha = 255) {
  const [cr, cg, cb] = hex(color);
  const s = SS;
  [x0, y0, x1, y1, r] = [x0 * s, y0 * s, x1 * s, y1 * s, r * s];
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      // Dentro do retângulo com cantos arredondados?
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      if (dx * dx + dy * dy > r * r) continue;
      const i = (y * W + x) * 4;
      const a = alpha / 255;
      buf[i] = buf[i] * (1 - a) + cr * a;
      buf[i + 1] = buf[i + 1] * (1 - a) + cg * a;
      buf[i + 2] = buf[i + 2] * (1 - a) + cb * a;
      buf[i + 3] = Math.max(buf[i + 3], alpha);
    }
  }
}

// fundo
roundRect(0, 0, 256, 256, 56, '#171227');
// ecrã grande (slide atual)
roundRect(34, 68, 158, 162, 12, '#F4F2F9');
// barra de destaque dentro do slide
roundRect(50, 88, 108, 100, 6, '#B06FD8');
roundRect(50, 112, 134, 120, 4, '#C9C3DA');
roundRect(50, 130, 116, 138, 4, '#C9C3DA');
// ecrã pequeno (o seguinte)
roundRect(172, 96, 222, 134, 8, '#B06FD8');

// reduzir 4x -> 1x com média por caixa
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3];
      }
    }
    const n = SS * SS, o = (y * SIZE + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
}

// --- encoder PNG -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filtro "none"
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const root = process.argv[2] || path.join(__dirname, '..');
const dest = path.join(root, 'build', 'icon.png');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, png);
console.log('escrito', dest, (png.length / 1024).toFixed(1) + ' KB');
