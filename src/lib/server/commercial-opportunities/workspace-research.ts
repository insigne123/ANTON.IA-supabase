import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { answerSchema, extractionSchema, REPORT_VERSION, validOpportunityCitation, validateOpportunityFacts, type DocumentChunk, type OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { opportunityReportPrompt, opportunitySynthesisSources } from '@/lib/commercial-opportunities/report-generation';
import { OPPORTUNITY_BUCKET, opportunityFinancialScenario, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityRead } from './workspace-access';
import { opportunityDb } from './workspace-store';
import { runOpportunitySpecialists } from './workspace-specialists';
import { opportunityGenerate, opportunityGenerateReport, type OpportunityJob } from './workspace-ai';
import { saveOpportunityDocument } from './workspace-documents';
import { downloadOpportunitySource, opportunityAttachmentLinks } from './workspace-download';
import { resolveTicketForOrganization } from './tickets';
import { MERCADO_PUBLICO_BASE } from './mercado-publico';
import {gatherOpportunityBuyerContext} from './workspace-public-research';
import {readPublicMercadoDocuments} from './mercado-publico-documents';
import { opportunityReportWarnings } from '@/lib/commercial-opportunities/report-view';
import { opportunityChatDeadline, opportunityChatReportContext } from '@/lib/commercial-opportunities/chat-context';
import { nextReportProgress, type ReportProgressNote } from '@/lib/commercial-opportunities/report-progress';
import { validateSubmissionKit } from '@/lib/commercial-opportunities/submission-kit';
import { TENDER_PROFILE_RULE, tenderProfileForModel } from '@/lib/commercial-opportunities/tender-profile';
import { loadTenderProfile } from './tender-profile-read';

/** What the page's «oficina» shows (report-progress.ts): a note in the job's payload. The report matters more than its progress, so a
 * note that cannot be written never stops the job. */
async function noteProgress(client: SupabaseClient, job: OpportunityJob, note: ReportProgressNote) {
  job.payload.progress = nextReportProgress(job.payload.progress, note, new Date());
  try { await client.from('opportunity_jobs').update({ payload: job.payload }).eq('id', job.id).eq('lease_token', job.lease_token); } catch { /* next note */ }
}

export async function enqueueOpportunityResearch(client: SupabaseClient, scope: WorkScope, id: string) {
  await assertOpportunityRead(client, scope, id);
  const [context, docs] = await Promise.all([
    client.from('opportunity_company_context').select('revision,offer').eq('organization_id', scope.organizationId).maybeSingle(),
    client.from('opportunity_documents').select('id,sha256').eq('organization_id', scope.organizationId).eq('opportunity_id', id).order('id'),
  ]);
  const profile = opportunityDb(context);
  if (!profile) throw new AuthError('Un administrador debe confirmar primero la oferta del workspace.', 409);
  const sourceDocuments = opportunityDb(docs) || [];
  const item=opportunityDb(await client.from('commercial_opportunities').select('title,company_name,url,deadline_at,data').eq('organization_id',scope.organizationId).eq('id',id).single());
  const hash = createHash('sha256').update(JSON.stringify({ version: REPORT_VERSION, documents: sourceDocuments, revision: profile.revision,item })).digest('hex');
  const key = `research:${id}:${hash}`;
  const row = opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, opportunity_id: id,
    requested_by: scope.userId, kind: 'research', dedupe_key: key, payload: { contentHash: hash, profileRevision: profile.revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }).select('id').maybeSingle());
  if (row?.id) return row.id;
  const found = opportunityDb(await client.from('opportunity_jobs').select('id,state').eq('organization_id', scope.organizationId).eq('dedupe_key', key).single());
  if (!found) throw new AuthError('No se pudo recuperar el trabajo.', 503);
  if(found.state==='blocked') {
    // Same job, same budget steps: a budget or content block recovers its receipts and results.
    opportunityDb(await client.from('opportunity_jobs').update({state:'queued',error:null}).eq('id',found.id).eq('organization_id',scope.organizationId).eq('state','blocked'));
  }
  if(found.state==='failed') {
    // A failed job keeps its uncertain paid call reserved forever, so retrying it could never pass that step: the person's
    // retry starts a new job with its own budget steps. An active retry is reused, so a double click does not pay twice.
    const active=opportunityDb(await client.from('opportunity_jobs').select('id').eq('organization_id',scope.organizationId).eq('opportunity_id',id)
      .eq('kind','research').like('dedupe_key',`${key}:retry:%`).in('state',['queued','running','waiting']).limit(1).maybeSingle());
    if(active?.id) return active.id;
    const retry=opportunityDb(await client.from('opportunity_jobs').insert({ organization_id: scope.organizationId, opportunity_id: id, requested_by: scope.userId,
      kind: 'research', dedupe_key: `${key}:retry:${randomUUID()}`, payload: { contentHash: hash, profileRevision: profile.revision } }).select('id').single());
    if (!retry) throw new AuthError('No se pudo recuperar el trabajo.', 503);
    return retry.id;
  }
  return found.id;
}
export async function runOpportunityResearch(client: SupabaseClient, job: OpportunityJob, started: number) {
  const scope: WorkScope = { organizationId: job.organization_id, userId: job.requested_by };
  const id = job.opportunity_id!;
  await assertOpportunityRead(client, scope, id);
  const item = opportunityDb(await client.from('commercial_opportunities').select('*').eq('organization_id', job.organization_id).eq('id', id).single());
  const context = opportunityDb(await client.from('opportunity_company_context').select('*').eq('organization_id', job.organization_id).single());
  if (context.revision !== job.payload.profileRevision) throw new AuthError('La oferta cambió. Solicita un análisis con el contexto actualizado.', 409);
  const warnings: string[] = [];
  if(item.kind==='tender'&&item.url&&!job.payload.publicDocumentsChecked){
    try{
      const result=await readPublicMercadoDocuments(item.url,async file=>{await saveOpportunityDocument(client,scope,id,{name:file.name,bytes:file.bytes,sourceKind:'official',sourceUrl:file.sourceUrl});},{deadline:started+90000});
      warnings.push(...result.warnings);job.payload.attachmentsUrl=result.attachments;
    }catch{warnings.push('No se pudieron obtener los formularios y el foro desde la ficha pública.');}
    job.payload.publicDocumentsChecked=true;job.payload.publicDocumentWarnings=warnings.slice();
    opportunityDb(await client.from('opportunity_jobs').update({payload:job.payload}).eq('id',job.id).eq('lease_token',job.lease_token));
    // Persist sources first; extraction resumes in its next tick with all remaining time available.
    return {waiting:true as const};
  }
  warnings.push(...job.payload.publicDocumentWarnings||[]);
  if (item.kind === 'tender' && item.data?.observed?.code && !job.payload.officialChecked) {
    const ticket = await resolveTicketForOrganization(client, { organizationId: job.organization_id, creatorId: job.requested_by });
    if (ticket) {
      try {
        const response = await fetch(`${MERCADO_PUBLICO_BASE}?${new URLSearchParams({ codigo: item.data.observed.code, ticket: ticket.ticket })}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.Listado) || !body.Listado[0]) throw new Error('Unavailable');
        await saveOpportunityDocument(client, scope, id, { name: `Ficha oficial ${item.data.observed.code}.txt`, bytes: Buffer.from(JSON.stringify(body.Listado[0], null, 2)), sourceKind: 'official', sourceUrl: `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${encodeURIComponent(item.data.observed.code)}` });
      } catch { warnings.push('No se pudo actualizar el detalle oficial de la licitación.'); }
    } else warnings.push('Conecta el ticket de Mercado Público en «Empresa del workspace» para incorporar la ficha oficial.');
    job.payload.officialChecked = true;
  }
  if (item.url && !job.payload.sourcesChecked) {
    try {
      const root = await downloadOpportunitySource(item.url);
      const rootName = root.name === 'Fuente.html' ? (item.kind === 'tender' ? 'Ficha pública de Mercado Público.html' : 'Página de la oportunidad.html') : root.name;
      // A page changes a little on every visit (session ids, timestamps): the new capture replaces the old one instead of
      // adding a copy whose fragments repeat in the report and the chat.
      if (/\.html$/i.test(rootName)) await replaceCapturedPage(client, scope, id, rootName);
      await saveOpportunityDocument(client, scope, id, { name: rootName, bytes: root.bytes, sourceKind: item.kind === 'private' ? 'public_web' : 'official', sourceUrl: root.url });
      const links = root.mime.includes('html') ? opportunityAttachmentLinks(root.bytes.toString('utf8'), root.url) : [];
      for (const link of links) {
        if (Date.now() - started > 90_000) { warnings.push('Quedaron enlaces por descargar.'); break; }
        try { const file = await downloadOpportunitySource(link); await saveOpportunityDocument(client, scope, id, { name: file.name, bytes: file.bytes, sourceKind: 'official', sourceUrl: file.url }); }
        catch { warnings.push('Un adjunto requiere acceso adicional o no pudo descargarse.'); }
      }
      if (root.mime.includes('html') && !links.length) warnings.push('No se obtuvo un inventario completo de bases y anexos desde la página.');
    } catch { warnings.push('No se pudo acceder a la fuente enlazada. Puedes adjuntar los documentos recibidos.'); }
    job.payload.sourcesChecked = true; job.payload.sourceWarnings = warnings;
    opportunityDb(await client.from('opportunity_jobs').update({ payload: job.payload }).eq('id', job.id).eq('lease_token', job.lease_token));
  }
  if (item.data?.description) await saveOpportunityDocument(client, scope, id, { name: 'Ficha de oportunidad.txt', bytes: Buffer.from(JSON.stringify({ title: item.title, buyer: item.buyer_name || item.company_name, deadline: item.deadline_at, amount: item.amount, currency: item.currency, source: item.url, description: item.data.description }, null, 2)), sourceKind: item.kind === 'private' ? 'pasted' : 'official' });
  if(!job.payload.buyerContextChecked){
    await noteProgress(client, job, { stage: 'buyer' });
    const publicWarnings=await gatherOpportunityBuyerContext(client,job,{name:item.buyer_name||item.company_name||'',domain:item.company_domain||null},started);
    job.payload.buyerContextChecked=true;job.payload.publicWarnings=publicWarnings;
    opportunityDb(await client.from('opportunity_jobs').update({payload:job.payload}).eq('id',job.id).eq('lease_token',job.lease_token));
  }
  warnings.push(...job.payload.publicWarnings||[]);
  const documents = opportunityDb(await client.from('opportunity_documents').select('*').eq('organization_id', job.organization_id).eq('opportunity_id', id).order('id')) || [];
  const manifest=documents.map(d=>({id:d.id,hash:d.sha256,status:d.extraction_status}));
  const manifestHash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  if(job.payload.manifestHash && job.payload.manifestHash!==manifestHash)throw new AuthError('El expediente recibió documentos nuevos. Solicita un análisis actualizado.',409);
  if(!job.payload.manifestHash){job.payload.manifestHash=manifestHash;job.payload.documentIds=documents.map(d=>d.id);job.payload.cutoff=new Date().toISOString();
    const updated=opportunityDb(await client.from('opportunity_jobs').update({payload:job.payload}).eq('id',job.id).eq('lease_token',job.lease_token).select('id').maybeSingle());
    if(!updated)throw new AuthError('El trabajo se retomó en otro proceso.',409);
  }
  const chunks:DocumentChunk[]=[];
  for(let page=0;page<20;page++){
    const batch=opportunityDb(await client.from('opportunity_document_chunks').select('id,document_id,ordinal,locator,content').eq('organization_id',job.organization_id).eq('opportunity_id',id).order('document_id').order('ordinal').range(page*1000,page*1000+999)) as DocumentChunk[] || [];
    chunks.push(...batch);if(batch.length<1000)break;
  }
  if (!chunks.length) throw new AuthError('Faltan documentos legibles para investigar. Adjunta las bases o la invitación.', 422);
  if (chunks.length >= 20000) warnings.push('La extracción supera la capacidad de esta versión de análisis.');
  const facts: Array<{ text: string; state: string; citations: any[] }> = [];
  let skippedBlocks = 0;
  const missing: string[] = [];
  const parts = Math.ceil(chunks.length / 4);
  let noted = 0;
  for (let offset = 0; offset < chunks.length; offset += 4) {
    if (Date.now() - started > 120_000) return { waiting: true as const };
    const block = chunks.slice(offset, offset + 4);
    // Every few seconds, not every part: parts already read come back in a moment when a job resumes.
    if (Date.now() - noted > 3000) {
      noted = Date.now();
      await noteProgress(client, job, { stage: 'read', read: offset / 4, total: parts, document: documents.find(d => d.id === block[0].document_id)?.name || null });
    }
    let extracted;
    // One unreadable block (a malformed model answer, or one already paid and unanswered) does not sink the whole report.
    try { extracted = await opportunityGenerate(client, job, { step: `extract:${createHash('sha256').update(block.map(c => c.id).join('|')).digest('hex')}`, category: 'research', role: 'extract', schema: extractionSchema, output: 4500,
      prompt: `Extrae TODOS los requisitos, fechas, cifras, criterios, garantías y obligaciones de estos fragmentos. Conserva contradicciones y títulos que no correspondan al objeto. No interpretes una licitación privada con normas públicas. Las páginas de contexto público no son bases ni requisitos; sus hechos solo se atribuyen al cliente con identidad suficiente. En foros distingue preguntas de participantes y respuestas oficiales: una pregunta no acredita un requisito ni un error de las bases. Cita juntos pregunta y respuesta cuando esta sea breve. Cada hecho documentado lleva chunkId y cita literal con el dato, cifra, unidad y período que respalda, no solo una etiqueta. missing se refiere solo a estos bloques; no declares ausente una respuesta o dato de un bloque vecino. Lo desconocido queda desconocido. Oferta del workspace: ${context.offer}\n${JSON.stringify(block)}` });
    } catch (error) {
      if (!(error instanceof AuthError) || ![503, 409].includes(error.status) || /presupuesto|otro proceso/i.test(error.message)) throw error;
      skippedBlocks++; continue;
    }
    facts.push(...validateOpportunityFacts(extracted.facts, block)); missing.push(...extracted.missing);
  }
  if (skippedBlocks) warnings.push(skippedBlocks === 1 ? 'Una parte de los documentos no se pudo leer y el informe no la considera.' : `${skippedBlocks} partes de los documentos no se pudieron leer y el informe no las considera.`);
  if (skippedBlocks * 4 >= chunks.length) throw new AuthError('No pudimos leer los documentos. Intenta de nuevo en un momento.', 503);
  await noteProgress(client, job, { stage: 'write', total: parts });
  // The specialists read the facts in parallel (Haiku, a few seconds); on a later tick their answers come back paid.
  const review = await runOpportunitySpecialists(client, job, { kind: item.kind, title: item.title, buyer: item.buyer_name || item.company_name || null,
    deadline: item.deadline_at || null, offer: String(context.offer || ''), facts, missing });
  // Writing the report takes up to 230 s: after a long reading it starts in the next tick, where the read blocks come
  // back from their paid results in a few seconds.
  if (Date.now() - started > 45_000) return { waiting: true as const };
  const raw = await opportunityGenerateReport(client, job, { step: `synthesis-envelope-v2:${createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`, output: 16_000,
    prompt: opportunityReportPrompt(job.payload.cutoff, { item, company: { offer: context.offer, services: context.services, territories: context.territories }, facts, missing,
      specialists: review.notes.map(({ id, ...note }) => note),
      sources: opportunitySynthesisSources(chunks), warnings: [...warnings, ...(job.payload.sourceWarnings || [])], documents: documents.map(d => ({ id: d.id, name: d.name, status: d.extraction_status })) }, item.kind) });
  const check = (citations: any[]) => citations.filter(c => validOpportunityCitation(c, chunks));
  raw.sections = raw.sections.map(section => ({ ...section, facts: validateOpportunityFacts(section.facts, chunks) }));
  raw.requirements = raw.requirements.map(r => { const evidence = check(r.evidence); return { ...r, evidence, status: r.status === 'supported' && !evidence.length ? 'unknown' : r.status }; });
  raw.milestones = raw.milestones.map(m => { const citations = check(m.citations); return { ...m, citations, state: m.state === 'documented' && !citations.length ? 'unknown' : m.state }; });
  raw.risks = raw.risks.map(r => { const citations = check(r.citations); return { ...r, citations, basis: r.basis === 'documented' && !citations.length ? 'unknown' : r.basis }; });
  raw.scenarios = raw.scenarios.filter(s => { try { opportunityFinancialScenario(s); return true; } catch { return false; } });
  // Asking for the bases only makes sense while one can still bid.
  const open = !item.deadline_at || Date.parse(item.deadline_at) > Date.now();
  const basesMissing = open && ['tender', 'compra_agil'].includes(item.kind) && !documents.some(d => d.source_kind === 'upload');
  raw.warnings = opportunityReportWarnings([...raw.warnings, ...warnings, ...(job.payload.sourceWarnings || [])], documents, basesMissing);
  if(raw.recommendation==='advance' && (raw.warnings.length || raw.requirements.some(r=>r.status==='unknown'||r.status==='blocked')))raw.recommendation='conditional';
  const report: OpportunityReport = { ...raw, kind: item.kind, generatedAt: job.payload.cutoff,
    route: review.route, reviewers: review.notes.map(note => note.name), submission: review.kit ? validateSubmissionKit(review.kit, chunks) : null,
    coverage: documents.map(d => ({ id: d.id, name: d.name, status: d.extraction_status, pagesRead: d.pages_read, pagesTotal: d.pages_total })),
    sources: chunks.map(c => ({ id: c.id, documentId: c.document_id, locator: c.locator, name: documents.find(d => d.id === c.document_id)?.name || 'Documento' })) };
  return { waiting: false as const, report };
}
/** Removes an earlier capture of the same page (its row, its fragments by cascade and its stored file). */
async function replaceCapturedPage(client: SupabaseClient, scope: WorkScope, id: string, name: string) {
  const old = (opportunityDb(await client.from('opportunity_documents').select('id,storage_path').eq('organization_id', scope.organizationId).eq('opportunity_id', id)
    .eq('name', name).neq('source_kind', 'upload')) || []) as Array<{ id: string; storage_path: string | null }>;
  if (!old.length) return;
  opportunityDb(await client.from('opportunity_documents').delete().eq('organization_id', scope.organizationId).eq('opportunity_id', id).in('id', old.map(doc => doc.id)));
  const paths = old.flatMap(doc => doc.storage_path ? [doc.storage_path] : []);
  if (paths.length) await client.storage.from(OPPORTUNITY_BUCKET).remove(paths).catch(() => undefined);
}
export async function runOpportunityChat(client: SupabaseClient, job: OpportunityJob) {
  const scope = { organizationId: job.organization_id, userId: job.requested_by };
  await assertOpportunityRead(client, scope, job.opportunity_id!);
  const message = opportunityDb(await client.from('opportunity_chat_messages').select('*').eq('organization_id', job.organization_id).eq('user_id', job.requested_by).eq('opportunity_id', job.opportunity_id).eq('request_id', job.payload.requestId).single());
  const found = opportunityDb(await client.rpc('opportunity_search_chunks', { p_org: job.organization_id, p_user: job.requested_by, p_id: job.opportunity_id, p_query: message.question })) as DocumentChunk[];
  const chunks = found?.length ? found : opportunityDb(await client.from('opportunity_document_chunks').select('id,document_id,locator,ordinal,content').eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id).order('ordinal').limit(8)) as DocumentChunk[];
  const report = message.report_id ? opportunityDb(await client.from('opportunity_reports').select('report').eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id).eq('id', message.report_id).maybeSingle()) : null;
  const item = opportunityDb(await client.from('commercial_opportunities').select('kind,title,buyer_name,company_name,deadline_at,reasons').eq('organization_id', job.organization_id).eq('id', job.opportunity_id).maybeSingle());
  const context = opportunityDb(await client.from('opportunity_company_context').select('offer').eq('organization_id', job.organization_id).maybeSingle());
  const ficha = await loadTenderProfile(client, job.organization_id);
  const summary = opportunityChatReportContext(report?.report);
  // The conversation so far (the last six turns, oldest first), so a follow-up («¿y el plazo?») reads as one.
  const earlier = (opportunityDb(await client.from('opportunity_chat_messages').select('question,answer,created_at').eq('organization_id', job.organization_id)
    .eq('user_id', job.requested_by).eq('opportunity_id', job.opportunity_id).lt('created_at', message.created_at).not('answer', 'is', null)
    .order('created_at', { ascending: false }).limit(6)) || []) as Array<{ question: string; answer: { answer?: string } | null }>;
  const conversation = earlier.reverse().map(turn => ({ pregunta: turn.question.slice(0, 600), respuesta: String(turn.answer?.answer || '').slice(0, 900) }));
  const answer = await opportunityGenerate(client, job, { step: 'answer', category: 'chat', role: 'chat', schema: answerSchema, output: 3000,
    prompt: `Eres el asistente de ANTON.IA dentro del expediente de esta oportunidad y conversas con quien la trabaja. Responde en español de Chile, cálido y directo, en no más de 150 palabras salvo que pidan un texto. Usa markdown simple: párrafos cortos, listas con guiones al enumerar y **negrita** para lo clave; sin títulos.
Si es un saludo, un agradecimiento o una pregunta general que no depende del expediente, responde breve y natural, sin citas, ofrece dos o tres cosas concretas que puedes hacer con este expediente y usa mode «conversation». Si respondes algo del expediente, usa mode «expedient».
Cita el fragmento exacto mediante chunkId y quote. Si la evidencia no alcanza, dilo en una frase y sugiere qué consultar. No presentes una propuesta como obligación. Se recuperó una parte del expediente, no todos los documentos.
Si la pregunta sigue la conversación previa («¿y el plazo?», «resúmelo»), respóndela en ese contexto.
Escribe fechas y horas en hora de Chile; nunca menciones UTC. Lo que el informe ya estableció (requisitos con su estado, fechas) puedes usarlo diciendo que viene del informe: no digas que no existe solo porque no está en los fragmentos; si un fragmento lo contradice, dilo.
Si piden redactar algo (un mensaje, un correo, una consulta), entrégalo listo para copiar, con datos del expediente y de la oferta, sin inventar nombres, cifras ni capacidades; si falta un dato, deja un espacio como [nombre].
missing: a lo más 3 datos que cambiarían esta respuesta, en frases cortas; vacío si no hay.
Oportunidad: ${JSON.stringify({ tipo: item?.kind, titulo: item?.title, cliente: item?.buyer_name || item?.company_name, cierre: opportunityChatDeadline(item?.deadline_at), porQueAparecio: item?.reasons })}
Oferta de tu empresa: ${String(context?.offer || '').slice(0, 1500)}
${ficha ? `Si preguntan si cumplen un requisito o si conviene postular, usa la ficha para licitaciones de la empresa. ${TENDER_PROFILE_RULE}\nFicha para licitaciones: ${JSON.stringify(tenderProfileForModel(ficha))}\n` : ''}Informe: ${JSON.stringify(summary)}
Conversación previa: ${JSON.stringify(conversation)}
Pregunta: ${message.question}
Fragmentos: ${JSON.stringify(chunks)}` });
  answer.citations = answer.citations.filter(c => validOpportunityCitation(c, chunks));
  if (!answer.citations.length && answer.mode !== 'conversation') answer.missing = ['No encontré una cita textual en los documentos para esto: confírmalo en las bases.', ...answer.missing];
  return answer;
}
