import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.cwd(), 'frontend/dist/assets');
const files = fs.readdirSync(dist).filter((f) => f.endsWith('.js'));
if (!files.length) {
  console.error('No JS bundles found in frontend/dist/assets');
  process.exit(1);
}

const limitBytes = 600 * 1024; // 600 KB raw main chunk budget
let failed = false;
for (const f of files) {
  const p = path.join(dist, f);
  const size = fs.statSync(p).size;
  if (size > limitBytes) {
    console.error(`Bundle ${f} is ${Math.round(size/1024)} KB (> 600 KB budget)`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('Bundle budget check passed');
