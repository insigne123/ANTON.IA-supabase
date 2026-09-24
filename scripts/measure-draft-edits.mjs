// Mide cuánto editan los ejecutivos los borradores generados (ciclo semanal).
// Solo lectura: cruza messaging_draft_versions (contenidos) con
// messaging_draft_generation_metadata (generation_method) y calcula la
// distancia de edición entre la primera versión modelo y la última humana.
// Uso: node scripts/measure-draft-edits.mjs [--org <uuid>] [--limit 200]
// Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Carga robusta de .env.local: ruta absoluta y comillas peladas a mano,
// porque el parseo por defecto no es confiable en este entorno.
function loadLocalEnv() {
  try {
    const text = readFileSync('C:\\Users\\nicol\\Desktop\\ANTON.IA\\.env.local', 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq === -1 || line.trim().startsWith('#')) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (key && value) process.env[key] = value;
    }
  } catch {
    dotenv.config({ path: '.env.local' });
  }
}
loadLocalEnv();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const orgArg = process.argv.indexOf('--org')
const orgFilter = orgArg === -1 ? null : process.argv[orgArg + 1]
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg === -1 ? 200 : Number(process.argv[limitArg + 1]) || 200

function tokens(text) {
  return (String(text || '').toLocaleLowerCase('es').match(/[\p{L}\p{N}]+/gu) || [])
}

// Distancia de edición a nivel de palabras (0 = idéntico, 1 = totalmente distinto).
function editRatio(before, after) {
  const a = tokens(before)
  const b = tokens(after)
  if (!a.length && !b.length) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = temp
    }
  }
  return Math.round((prev[b.length] / Math.max(a.length, b.length)) * 100) / 100
}

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
  .select('version_id,generation_method,prompt_version,model')
  .in('version_id', versionIds.length ? versionIds : ['00000000-0000-0000-0000-000000000000'])
const methodByVersion = new Map((metas || []).map((m) => [m.version_id, m]))

const report = []
for (const [draftId, rows] of byDraft) {
  if (rows.length < 2) continue
  const first = rows[0]
  const last = rows[rows.length - 1]
  const lastMeta = methodByVersion.get(last.id)
  if (!lastMeta || lastMeta.generation_method !== 'human') continue
  const before = `${first.content?.subject || ''}\n${first.content?.text || first.content?.html || ''}`
  const after = `${last.content?.subject || ''}\n${last.content?.text || last.content?.html || ''}`
  report.push({
    draftId,
    organization_id: first.organization_id,
    prompt_version: methodByVersion.get(first.id)?.prompt_version || null,
    model: methodByVersion.get(first.id)?.model || null,
    revisions: rows.length - 1,
    edit_ratio: editRatio(before, after),
  })
  if (report.length >= limit) break
}

const edited = report.length
const ratios = report.map((r) => r.edit_ratio).sort((x, y) => x - y)
const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null
const heavy = report.filter((r) => r.edit_ratio >= 0.5).length
console.log(JSON.stringify({
  drafts_con_edicion_humana: edited,
  mediana_edit_ratio: median,
  reescrituras_fuertes_ratio_mayor_05: heavy,
  detalle: report.slice(0, 50),
}, null, 2))
