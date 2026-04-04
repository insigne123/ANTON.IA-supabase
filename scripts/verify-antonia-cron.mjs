import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const baseUrl = String(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9003').replace(/\/$/, '')
const cronSecret = String(process.env.CRON_SECRET || '').trim()

async function checkEndpoint(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      'x-cron-secret': cronSecret,
    },
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

  if (!cronSecret) {
    console.error('Falta CRON_SECRET en .env.local')
    process.exit(1)
  }

  const checks = [
    ['/api/cron/antonia?dryRun=1&skipFirebaseForward=1', 'Cron principal'],
    ['/api/cron/process-campaigns?dryRun=1&includeDetails=1', 'Cron de campanas'],
  ]

  for (const [path, label] of checks) {
    try {
      const result = await checkEndpoint(path)
      console.log(`\n[${label}] ${result.status} ${result.ok ? 'OK' : 'FAIL'}`)
      console.log(JSON.stringify(result.body, null, 2))
    } catch (error) {
      console.error(`\n[${label}] ERROR`)
      console.error(error instanceof Error ? error.message : String(error))
    }
  }

  console.log('\nSiguiente paso sugerido: comparar estos resultados con Vercel logs y revisar que last_run_at cambie en produccion.')
}

main()
