import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const baseUrl = String(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9003').replace(/\/$/, '')
const cronSecret = String(process.env.CRON_SECRET || '').trim()
const firebaseSchedulerSecret = String(process.env.FIREBASE_SCHEDULER_SECRET || '').trim()

async function checkEndpoint(path, headers) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers,
  })

  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  return {
    ok: res.ok,
    status: res.status,
    body: json || text,
  }
}

async function main() {
  console.log('--- Verificacion Cron ANTON.IA ---')
  console.log(`Base URL: ${baseUrl}`)
  console.log(`CRON_SECRET: ${cronSecret ? 'OK' : 'MISSING'}`)
  console.log(`FIREBASE_SCHEDULER_SECRET: ${firebaseSchedulerSecret ? 'OK' : 'MISSING'}`)

  if (!cronSecret || !firebaseSchedulerSecret) {
    console.error('Faltan CRON_SECRET o FIREBASE_SCHEDULER_SECRET en .env.local')
    process.exit(1)
  }

  const checks = [
    [
      '/api/cron/antonia',
      'Compatibilidad legacy de ANTON.IA (debe responder 410)',
      { Authorization: `Bearer ${cronSecret}`, 'x-cron-secret': cronSecret },
    ],
    [
      '/api/cron/process-campaigns?dryRun=1&includeDetails=1',
      'Bridge de campanas de Firebase (dry run)',
      {
        'x-firebase-scheduler-secret': firebaseSchedulerSecret,
        'x-scheduler-owner': 'firebase-functions',
      },
    ],
  ]

  for (const [path, label, headers] of checks) {
    try {
      const result = await checkEndpoint(path, headers)
      console.log(`\n[${label}] ${result.status} ${result.ok ? 'OK' : 'FAIL'}`)
      console.log(JSON.stringify(result.body, null, 2))
    } catch (error) {
      console.error(`\n[${label}] ERROR`)
      console.error(error instanceof Error ? error.message : String(error))
    }
  }

  console.log('\nSiguiente paso sugerido: revisar los jobs y logs de Firebase Scheduler para todos los ticks propietarios.')
}

main()
