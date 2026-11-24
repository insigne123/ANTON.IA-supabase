// Journeys of the research list: what the page reads when someone with researched contacts opens «Por escribir», opens the research of
// one of them and comes back. On 24 Nov 2026 every reload of this list brought the full report of every contact again (36 MB for one
// account, 64 times in 14 minutes) and the database stopped answering for every customer. What is measured here is what travels:
// the first load brings the latest report of each contact, and a reload brings none (docs/investigacion-fila-y-lista-livianas.md).

const OWNER = '00000000-0000-4000-8000-000000000011';
const ORG = '00000000-0000-4000-8000-000000000001';
const lead = index => `00000000-0000-4000-8000-${String(2000 + index).padStart(12, '0')}`;
const jobId = number => `00000000-0000-4000-8000-${String(2600 + number).padStart(12, '0')}`;
const snapshotId = number => `00000000-0000-4000-8000-${String(2700 + number).padStart(12, '0')}`;
const FINDING = 'Abrió un centro de distribución en Pudahuel en octubre.';

/** A research job as the queue stores it; a finished one carries its report, which is the heavy part. */
function job(number, leadIndex, status, updatedAt, overrides = {}) {
  const finished = ['completed', 'partial', 'insufficient_data'].includes(status);
  const reportId = `native-report-${number}`;
  return {
    id: jobId(number), provider: 'native-research-v1', organization_id: ORG, user_id: OWNER, scope_key: ORG,
    lead_id: lead(leadIndex), lead_ref: lead(leadIndex), email: null, company_name: null, company_domain: null,
    provider_report_id: reportId, status, request_claim_state: finished ? 'submitted' : 'retryable', request_payload: {},
    research_snapshot_id: finished ? snapshotId(number) : null,
    result_payload: finished ? {
      status, reportId, researchSnapshotId: snapshotId(number), score: 74, angle: 'Contratación para el nuevo centro.',
      lead: { id: lead(leadIndex) },
      evidence: [{ id: `evidence-${number}`, statement: FINDING, sourceUrl: 'https://example.com/noticias/centro', kind: 'company_fact' }],
      sources: [{ id: `source-${number}`, title: 'Noticias de la empresa', url: 'https://example.com/noticias/centro', type: 'official_site' }],
      promptPack: { claims: [FINDING] }, quality: { score: 74, sufficientResearch: true }, draftEligibility: { eligible: true, blockReason: null },
      warnings: [],
    } : null,
    error_code: null, error_message: null, scheduled_for: updatedAt, started_at: finished ? updatedAt : null, completed_at: finished ? updatedAt : null,
    created_at: updatedAt, updated_at: updatedAt,
    ...overrides,
  };
}

/**
 * What the page asks while the journey runs. `calls`: every answer of the status list, with what the page said it holds and what
 * came back. `details`: the reports whose written version the page asked for, which it only does for a report it holds.
 */
function watchResearch(page) {
  const seen = { calls: [], details: [] };
  page.on('response', async response => {
    const { pathname } = new URL(response.url());
    if (pathname === '/api/native-research/status') {
      const sent = JSON.parse(response.request().postData() || '{}');
      const body = await response.json().catch(() => null);
      seen.calls.push({ known: sent.known || null, items: Array.isArray(body?.items) ? body.items : [], status: response.status() });
    } else if (response.request().method() === 'GET' && /^\/api\/native-research\/native-report-\d+$/.test(pathname)) {
      seen.details.push(pathname.split('/').pop());
    }
  });
  return seen;
}

export default function journeys() {
  let seen = { calls: [], details: [] };
  const withReport = call => call.items.filter(item => item.result);
  /** The next answer of the status list after `before` of them, waited for as a person waits for the list. */
  const nextCall = async (wait, before) => {
    for (let waited = 0; waited < 8000 && seen.calls.length <= before; waited += 250) await wait(250);
    return seen.calls[before];
  };
  return [{
    id: 'investigacion-lista-liviana',
    title: 'La lista de investigaciones no vuelve a traer los informes',
    persona: 'owner',
    goal: 'Abrir «Por escribir» con contactos ya investigados, abrir la investigación de uno y ver la que quedó sin cupo.',
    seed(tables) {
      const day = number => new Date(Date.UTC(2026, 10, number, 15, 0, 0)).toISOString();
      tables.lead_research_jobs = [
        job(1, 0, 'completed', day(3)),
        // The same contact researched again: only this report is read.
        job(2, 0, 'completed', day(20)),
        job(3, 1, 'completed', day(18)),
        job(4, 2, 'partial', day(19)),
        // Refused for lack of quota: the queue keeps it for the next day.
        job(5, 3, 'queued', day(23), { error_code: 'daily_research_quota_exceeded', error_message: 'Daily research quota exceeded.' }),
      ];
    },
    steps: [
      {
        say: 'Abro «Por escribir»',
        async do({ go, see, wait, page, check }) {
          seen = watchResearch(page);
          await go('/saved/leads/enriched');
          await see('Andrea Soto');
          const first = await nextCall(wait, 0);
          check('la lista de investigaciones respondió', first?.status === 200, `estado ${first?.status}`);
          check('la primera carga no dice tener nada', first && first.known === null);
          check('llegan los informes de los tres contactos investigados', first && withReport(first).length === 3, `${first ? withReport(first).length : 0} informes`);
          check('del contacto investigado dos veces llega el informe más reciente',
            first?.items.find(item => item.leadId === lead(0))?.reportId === 'native-report-2');
          check('la investigación en la fila llega sin informe y con su motivo',
            first?.items.find(item => item.leadId === lead(3))?.errorCode === 'daily_research_quota_exceeded'
              && first.items.find(item => item.leadId === lead(3)).result === null);
          // The list says the same as the research: it waits, nobody is working on it.
          const waiting = page.getByRole('row').filter({ hasText: 'Joaquín Díaz' });
          check('la lista dice «En la fila» y no «Investigando»', await waiting.getByText('En la fila').isVisible().catch(() => false)
            && !(await waiting.getByText('Investigando').isVisible().catch(() => false)));
        },
      },
      {
        say: 'Abro la investigación de Andrea Soto',
        async do({ click, see, wait, page, check }) {
          const before = seen.calls.length;
          seen.details.length = 0;
          await click('Ver investigación', { within: page.getByRole('row').filter({ hasText: 'Andrea Soto' }) });
          await see('Detalle de investigación').catch(() => {});
          const reload = await nextCall(wait, before);
          check('al abrir la investigación la lista se pide de nuevo', Boolean(reload));
          check('la página dice qué informes tiene', reload && Object.keys(reload.known || {}).length === 4, `${Object.keys(reload?.known || {}).length} versiones`);
          check('ningún informe vuelve a viajar', reload && withReport(reload).length === 0 && reload.items.every(item => item.unchanged === true),
            `${reload ? withReport(reload).length : '?'} informes en la recarga`);
          // The research has its findings and waits for the written report: the page knows the contact was researched.
          await see('Escribir y revisar el informe');
          for (let waited = 0; waited < 8000 && !seen.details.includes('native-report-2'); waited += 250) await wait(250);
          check('la página sigue con el informe que ya tenía', seen.details.includes('native-report-2'), `pidió ${seen.details.join(', ') || 'ninguno'}`);
        },
      },
      {
        say: 'Miro la investigación que quedó sin cupo',
        async do({ page, clickOn, see, check }) {
          const entry = page.getByRole('list', { name: 'Leads de la investigación' }).getByRole('listitem').filter({ hasText: 'Joaquín Díaz' });
          check('en la lista de la investigación dice «En la fila», sin barra de avance',
            await entry.getByText('En la fila').isVisible().catch(() => false) && await entry.getByRole('progressbar').count() === 0);
          await clickOn(entry.getByText('Joaquín Díaz'));
          await see('Queda en la fila');
          await see('se hará sola cuando se renueve el cupo');
        },
      },
      {
        say: 'Vuelvo a la lista',
        async do({ click, see, wait, check }) {
          const before = seen.calls.length;
          await click('Volver a leads');
          await see('Por escribir');
          const reload = await nextCall(wait, before);
          check('al volver, la lista se actualiza sin traer informes', reload && withReport(reload).length === 0 && Object.keys(reload.known || {}).length === 4,
            `${reload ? withReport(reload).length : '?'} informes`);
        },
      },
    ],
  }];
}
