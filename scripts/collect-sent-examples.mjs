// Exporta pares (generado, enviado) para curar el banco de ejemplos.
// Solo lectura: primera versión modelo vs última versión humana por borrador.
// La curaduría es humana: los mejores enviados entran a la librería, lo que
// se borra seguido entra a la lista de muletillas (ciclo semanal, guía §9).
// Uso: node scripts/collect-sent-examples.mjs [--org <uuid>] [--limit 50]
// Salida: JSONL en el dir temporal (no se commitea).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const orgArg = process.argv.indexOf('--org')
const orgFilter = orgArg === -1 ? null : process.argv[orgArg + 1]
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg === -1 ? 50 : Number(process.argv[limitArg + 1]) || 50

let query = supabase
  .from('messaging_draft_versions')
  .select('id,draft_id,organization_id,content,created_at')
  .order('created_at', { ascending: true })
  .limit(limit * 4)
if (orgFilter) query = query.eq('organization_id', orgFilter)
const { data: versions, error } = await query
if (error) throw error

const byDraft = new Map()
for (const row of versions || []) {
  const list = byDraft.get(row.draft_id) || []
  list.push(row)
  byDraft.set(row.draft_id, list)
}
const versionIds = (versions || []).map((row) => row.id)
const { data: metas } = await supabase
  .from('messaging_draft_generation_metadata')
  .select('version_id,generation_method,prompt_version')
  .in('version_id', versionIds.length ? versionIds : ['00000000-0000-0000-0000-000000000000'])
const methodByVersion = new Map((metas || []).map((m) => [m.version_id, m]))

const outDir = join('C:\\Users\\nicol\\AppData\\Local\\Temp\\opencode', 'sent-examples', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(outDir, { recursive: true })
const lines = []
for (const [draftId, rows] of byDraft) {
  if (rows.length < 2) continue
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (methodByVersion.get(first.id)?.generation_method !== 'model') continue
  if (methodByVersion.get(last.id)?.generation_method !== 'human') continue
  lines.push(JSON.stringify({
    draft_id: draftId,
    prompt_version: methodByVersion.get(first.id)?.prompt_version || null,
    generado: { asunto: first.content?.subject || '', cuerpo: first.content?.text || first.content?.html || '' },
    enviado: { asunto: last.content?.subject || '', cuerpo: last.content?.text || last.content?.html || '' },
  }))
  if (lines.length >= limit) break
}
writeFileSync(join(outDir, 'pares.jsonl'), lines.join('\n'))
console.log(`pares exportados: ${lines.length} en ${outDir}`)
