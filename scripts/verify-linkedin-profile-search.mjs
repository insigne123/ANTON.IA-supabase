import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const baseUrl = String(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9003').replace(/\/$/, '')
const internalSecret = String(process.env.INTERNAL_API_SECRET || '').trim()
const userId = String(process.env.LINKEDIN_PROFILE_TEST_USER_ID || '').trim()
const linkedinUrl = String(process.env.LINKEDIN_PROFILE_TEST_URL || '').trim()

if (!internalSecret || !userId || !linkedinUrl) {
  console.error('Faltan variables requeridas: INTERNAL_API_SECRET, LINKEDIN_PROFILE_TEST_USER_ID, LINKEDIN_PROFILE_TEST_URL')
  process.exit(1)
}

async function main() {
  console.log('--- Verify LinkedIn Profile Search ---')
  console.log(`Base URL: ${baseUrl}`)

  const operationId = `linkedin-profile-smoke:${crypto.randomUUID()}`
  const response = await fetch(`${baseUrl}/api/opportunities/enrich-apollo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-secret': internalSecret,
      'x-user-id': userId,
      'Idempotency-Key': operationId,
    },
    body: JSON.stringify({
      operationId,
      provider: 'apollo',
      tableName: 'people_search_leads',
      revealEmail: true,
      revealPhone: true,
      leads: [{
        clientRef: `profile-search:${linkedinUrl}`,
        linkedinUrl,
      }],
    }),
  })

  const data = await response.json().catch(() => null)
  console.log(`Status: ${response.status}`)
  if (!response.ok) {
    console.error(JSON.stringify(data, null, 2))
    process.exit(1)
  }

  const lead = Array.isArray(data?.enriched) ? data.enriched[0] : null
  const phone = lead?.primaryPhone || lead?.phoneNumbers?.[0]?.sanitized_number || null

  console.log(JSON.stringify({
    operation_id: response.headers.get('x-operation-id') || data?.operationId,
    provider: data?.providerUsed || response.headers.get('x-provider-used'),
    queued: data?.queued,
    requested_data: data?.requestedData,
    phone_enrichment: data?.phone_enrichment,
    lead: lead
      ? {
          id: lead.id,
          name: lead.fullName || null,
          email: lead.email || null,
          phone,
          enrichment_status: lead.enrichmentStatus || null,
        }
      : null,
  }, null, 2))
}

main().catch((error) => {
  console.error('Verification failed:', error)
  process.exit(1)
})
