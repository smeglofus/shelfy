import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = path.resolve(process.cwd(), 'frontend/dist/assets');
const files = fs.readdirSync(dist).filter((f) => f.endsWith('.js'));
if (!files.length) {
  console.error('No JS bundles found in frontend/dist/assets');
  process.exit(1);
}

// Gzip budget — reflects actual network transfer size, not minified raw size.
const limitBytes = 220 * 1024; // 220 KB gzip (current main chunk ~180 KB)
let failed = false;
for (const f of files) {
  const raw = fs.readFileSync(path.join(dist, f));
  const gzipped = zlib.gzipSync(raw);
  const kb = Math.round(gzipped.length / 1024);
  if (gzipped.length > limitBytes) {
    console.error(`Bundle ${f} is ${kb} KB gzip (> ${Math.round(limitBytes / 1024)} KB budget)`);
    failed = true;
  } else {
    console.log(`Bundle ${f}: ${kb} KB gzip ✓`);
  }
}
if (failed) process.exit(1);
console.log('Bundle budget check passed');
