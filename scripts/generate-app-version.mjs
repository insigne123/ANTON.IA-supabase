import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const pkgPath = resolve(root, 'package.json')
const outPath = resolve(root, 'src/lib/app-version.ts')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

function formatBuildStamp(date) {
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${day}-${month} ${hours}:${minutes}`
}

const version = String(pkg.version || '0.0.0').trim()
const buildVersion = `v${version} / ${formatBuildStamp(new Date())}`

writeFileSync(
  outPath,
  `export const APP_VERSION = ${JSON.stringify(buildVersion)};\n`,
  'utf8'
)

console.log(`[generate-app-version] ${buildVersion}`)
