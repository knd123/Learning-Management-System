// Writes Brotli (.br) and gzip (.gz) copies of the built portal's text files, once, at build time,
// so the server can send them compressed without spending CPU on every request (see server/compress.ts).
// Usage: node server/scripts/precompress.mjs dist/client
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(process.argv[2] || 'dist/client');
const TEXT = /\.(js|mjs|css|html|svg|json|txt|webmanifest)$/;
let before = 0;
let after = 0;
let files = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (TEXT.test(entry.name) && entry.name !== 'index.html') {
      const data = fs.readFileSync(full);
      if (data.length < 1024) continue;
      const br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
      const gz = zlib.gzipSync(data, { level: 9 });
      fs.writeFileSync(`${full}.br`, br);
      fs.writeFileSync(`${full}.gz`, gz);
      before += data.length;
      after += br.length;
      files++;
    }
  }
}

walk(root);
console.log(`precompressed ${files} files: ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB with Brotli`);
