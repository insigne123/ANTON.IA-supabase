import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const required = [
  'NEXT_PUBLIC_BASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'INTERNAL_API_SECRET',
  'APOLLO_WEBHOOK_SECRET',
]

const recommended = [
  'TRACKING_WEBHOOK_SECRET',
  'ANTONIA_FIREBASE_TICK_URL',
  'ANTONIA_FIREBASE_TICK_SECRET',
  'N8N_RESEARCH_WEBHOOK_URL',
  'GOOGLE_GENAI_API_KEY',
]

const missingRequired = required.filter((key) => !String(process.env[key] || '').trim())
const missingRecommended = recommended.filter((key) => !String(process.env[key] || '').trim())

console.log('--- Production config verification ---')
console.log(`Required present: ${required.length - missingRequired.length}/${required.length}`)
console.log(`Recommended present: ${recommended.length - missingRecommended.length}/${recommended.length}`)

if (missingRequired.length > 0) {
  console.error('\nMissing required variables:')
  for (const key of missingRequired) console.error(`- ${key}`)
}

if (missingRecommended.length > 0) {
  console.warn('\nMissing recommended variables:')
  for (const key of missingRecommended) console.warn(`- ${key}`)
}

const baseUrl = String(process.env.NEXT_PUBLIC_BASE_URL || '').trim()
const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || '').trim()
if (baseUrl && appUrl && baseUrl !== appUrl) {
  console.warn(`\nWarning: NEXT_PUBLIC_BASE_URL (${baseUrl}) != NEXT_PUBLIC_APP_URL (${appUrl})`)
}

if (missingRequired.length > 0) {
  process.exit(1)
}

console.log('\nOK: minimum production config is present.')
