// Journeys of the drafts: what a person sees on «Preparar correo» when the app could not write the email from a research, and on the draft that
// did get written. The model does not run in the bench, so the journeys answer with the bodies the server builds (src/lib/server/native-drafts.ts,
// blockedResult and failureResult for the refusals; the saved draft of MessagingDraftV1 for the one that was written): what is measured is the
// screen, the thing one person met 20 times in 78 minutes in production, not the quality of the text.
import { standsOut } from '../checks.mjs';

const OWNER = '00000000-0000-4000-8000-000000000011';
const ORG = '00000000-0000-4000-8000-000000000001';
const LEAD = '00000000-0000-4000-8000-000000002000';
const SNAPSHOT = '00000000-0000-4000-8000-000000009901';

/** The research of the contact as the browser keeps it (lead-research-storage); without it «Preparar correo» only offers to research. */
async function withResearch(page) {
  await page.addInitScript(({ key, lead, snapshot }) => {
    const now = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify({ version: 2, updatedAt: now, items: [{ createdAt: now, meta: { leadRef: lead }, raw: { research_snapshot_id: snapshot } }] }));
  }, { key: `leadflow-lead-research:v2:user:${OWNER}:organization:${ORG}`, lead: LEAD, snapshot: SNAPSHOT });
}

/** The server's answer to «Crear borrador»; the journey writes nothing, the bench would answer 503. */
async function answerCreate(page, status, body) {
  await page.route('**/api/native-drafts', route => route.request().method() === 'POST'
    ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    : route.continue());
}

const REFUSED = {
  ok: false, error: 'draft_preflight_failed', message: 'El borrador no cumple los controles de evidencia y calidad.',
  issues: [
    { code: 'unsupported_material_claim', message: 'La cifra o su alcance no están respaldados para este sujeto: 1.390. Oración (extracto limitado): "Procesamos 1.390 consultas".' },
    { code: 'personalization_invalid', message: 'La personalización debe referenciar un claim factual respaldado por evidencia.' },
  ],
};
const DOWN = { ok: false, error: 'openai_generation_failed', message: 'OpenAI no está disponible para generar un borrador verificable.', issues: [] };

const DRAFT = '00000000-0000-4000-8000-000000009a01';
/** A draft the app wrote and nobody has approved yet (MessagingDraftV1), as GET /api/native-drafts/:id returns it. */
const WRITTEN = { draft: {
  schemaVersion: 1, draftId: DRAFT, versionId: '00000000-0000-4000-8000-000000009a02', organizationId: ORG, userId: OWNER, researchSnapshotId: SNAPSHOT,
  revision: 1, parentVersionId: null, lifecycle: 'draft', channel: 'email',
  recipient: { leadRef: LEAD, displayName: 'Andrea Soto', email: 'andrea.soto@retailandino.cl', linkedinUrl: null },
  content: {
    subject: 'Contrataciones en las tiendas nuevas',
    text: 'Hola Andrea,\n\nVi que Retail Andino abrió doce tiendas este año. Cada apertura trae contrataciones masivas, y revisar antecedentes laborales a mano se vuelve el cuello de botella.\n\nAXIS consulta antecedentes laborales de postulantes en el PJUD y procesa 1.000 personas en unos 30 minutos.\n\n¿Cuántas contrataciones revisan al mes?\n\nSaludos,\nCamila',
    html: null,
  },
  approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
  preflight: { status: 'passed', checkedAt: new Date().toISOString(), issues: [] },
  createdAt: new Date().toISOString(),
} };
const answerDraft = page => page.route(`**/api/native-drafts/${DRAFT}`, route => route.request().method() === 'GET'
  ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WRITTEN) })
  : route.continue());

const open = async c => {
  await withResearch(c.page);
  await c.go(`/contact/compose?id=${LEAD}`);
  await c.see('Crear borrador para revisar');
};

export default () => [
  { id: 'borrador-no-se-pudo-escribir', persona: 'owner', title: 'El borrador no pasa la verificación, una y otra vez',
    goal: 'Entender por qué no sale el correo y qué hacer, sin pulsar el mismo botón 20 veces.',
    steps: [
      { say: 'Abro «Preparar correo» de un contacto con investigación', do: async c => { await answerCreate(c.page, 422, REFUSED); await open(c); } },
      { say: 'Pulso «Crear borrador» y no pasa la verificación', do: async c => {
        await c.click('Crear borrador para revisar');
        await c.see('No logré escribir un correo que se pueda respaldar');
        c.check('dice la causa en palabras de la persona', await c.has('no respalda'));
        c.check('no muestra el mensaje interno para el modelo', !(await c.has('Oración (extracto limitado)')) && !(await c.has('claim factual')));
        c.check('la primera vez deja intentar una vez más', await c.has('una vez más'));
      } },
      { say: 'Lo intento otra vez y vuelve a fallar', do: async c => {
        await c.click('Crear borrador para revisar');
        await c.see('Ya van dos intentos');
        c.check('a la segunda manda a investigar de nuevo', await c.has('Investiga de nuevo a este contacto'));
        const primary = await c.page.getByRole('link', { name: /Investigar a este contacto/ }).first().evaluate(node => node.className).catch(() => '');
        c.check('«Investigar a este contacto» pasa a ser la acción principal', /bg-primary/.test(primary), primary.slice(0, 120));
      } },
      { say: 'Recargo la página: la cuenta de fallas no se pierde', do: async c => {
        await c.page.reload({ waitUntil: 'domcontentloaded' });
        await c.see('Crear borrador para revisar');
        await c.click('Crear borrador para revisar');
        await c.see('Ya van dos intentos');
      } },
    ] },
  { id: 'borrador-servicio-caido', persona: 'owner', viewport: 'phone', title: 'El servicio de redacción no responde (móvil)',
    goal: 'Saber que no es un problema de la investigación y que basta con esperar un minuto.',
    steps: [
      { say: 'Abro «Preparar correo» en el móvil', do: async c => { await answerCreate(c.page, 503, DOWN); await open(c); } },
      { say: 'Pulso «Crear borrador» y el servicio no responde', do: async c => {
        await c.click('Crear borrador para revisar');
        await c.see('El servicio de redacción no respondió');
        c.check('dice que no es la investigación', await c.has('No es un problema de la investigación'));
        c.check('«Crear borrador» sigue siendo la acción principal', !(await c.page.getByRole('link', { name: /Investigar a este contacto/ }).first().evaluate(node => /bg-primary/.test(node.className)).catch(() => false)));
      } },
    ] },
  { id: 'borrador-revisar', persona: 'owner', title: 'Revisar el correo que escribió la IA antes de enviarlo',
    goal: 'Leer el correo, saber desde qué cuenta saldría y qué falta para enviarlo.',
    steps: [
      { say: 'Abro el borrador que quedó listo para revisar', do: async c => { await answerDraft(c.page); await c.go(`/contact/compose?draftId=${DRAFT}`); await c.seeRole('group', 'Proveedor de envío'); } },
      { say: 'Reviso que se vea desde qué cuenta saldría', do: async c => {
        const group = c.page.getByRole('group', { name: 'Proveedor de envío' });
        const { ok, ratio } = await standsOut(group.locator('button[aria-pressed="true"]').first(), group.locator('button[aria-pressed="false"]').first());
        c.check('el proveedor elegido se distingue del otro', ok, `contraste ${ratio} a 1`);
      } },
    ] },
  { id: 'borrador-revisar-telefono', persona: 'owner', viewport: 'phone', title: 'Revisar el correo que escribió la IA (móvil)',
    goal: 'Leer el correo y encontrar qué hacer, sin desbordes, en una pantalla angosta.',
    steps: [
      { say: 'Abro el borrador en el móvil', do: async c => { await answerDraft(c.page); await c.go(`/contact/compose?draftId=${DRAFT}`); await c.seeRole('group', 'Proveedor de envío'); } },
    ] },
];
