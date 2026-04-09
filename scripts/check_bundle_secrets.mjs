import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve('frontend/dist')

const patterns = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /sk_(?:live|test)_[0-9A-Za-z]+/g,
  /rk_(?:live|test)_[0-9A-Za-z]+/g,
  /whsec_[0-9A-Za-z]+/g,
  /-----BEGIN PRIVATE KEY-----/g,
  /GEMINI_API_KEY/g,
  /STRIPE_SECRET_KEY/g,
  /JWT_SECRET_KEY/g,
  /MINIO_SECRET_KEY/g,
]

function listFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

if (!fs.existsSync(distDir)) {
  console.error(`dist directory not found: ${distDir}`)
  process.exit(1)
}

const files = listFiles(distDir).filter((f) => /\.(js|css|html|map|txt)$/i.test(f))
let failed = false

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match?.length) {
      failed = true
      const rel = path.relative(process.cwd(), file)
      console.error(`Secret-like pattern detected in ${rel}: ${pattern} (${match[0].slice(0, 48)}...)`)
    }
  }
}

if (failed) {
  process.exit(1)
}

console.log('Bundle secret-pattern check passed')
