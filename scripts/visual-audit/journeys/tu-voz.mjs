// «Tu voz» in «Firmas y estilo» (11 Nov 2026): the person asks the app to look in what they sent, chooses the emails that sound like
// them and keeps them, and takes one out. The mailbox and the table do not run in the bench: the journey answers with the bodies the
// server returns (src/app/api/email-studio/voice-samples/route.ts), and what is measured is the screen. Fictional people and companies.

const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const candidate = (id, subject, sentAt, body) => ({ id, subject, sentAt, body, words: (body.match(/[\p{L}\p{N}]+/gu) || []).length });
const CANDIDATES = [
  candidate('c1', 'Equipo para las aperturas', '2026-11-03T14:00:00Z', 'Hola Rodrigo,\n\nTe escribo porque supe que abren dos tiendas en la zona sur antes de diciembre y me imagino que ya están viendo cómo armar los equipos.\n\nNosotros ponemos personal temporal para esas semanas y nos hacemos cargo de los contratos. ¿Te parece si lo vemos 15 minutos el jueves?\n\nSaludos,'),
  candidate('c2', 'Lo que conversamos en la feria', '2026-10-27T15:30:00Z', 'Hola Marcela, ¿cómo estás?\n\nTe cuento cortito: estamos partiendo con un par de empresas de tu rubro y me acordé de ti por lo que conversamos en la feria. La idea es simple, que tu equipo deje de perseguir informes.\n\nSi te tinca, te muestro cómo funciona en una llamada. ¿Te acomoda el miércoles en la mañana?\n\nUn abrazo,'),
  candidate('c3', 'Turnos de fin de semana', '2026-10-20T12:10:00Z', 'Hola Daniela,\n\nGracias por recibirme el otro día. Me quedé pensando en lo que dijiste de los turnos de fin de semana, y creo que ahí es donde más te podemos ayudar.\n\nTe propongo algo fácil: partimos con un grupo chico y ves si te sirve. ¿Qué te parece?\n\nUn abrazo,'),
];
const saved = list => list.map((item, index) => ({ id: `00000000-0000-4000-8000-00000000090${index}`, source: 'mailbox', provider: 'outlook', subject: item.subject, body: item.body, sentAt: item.sentAt }));

/** The API of the screen, as the server answers it: nothing kept until the person saves, and the list after each change. */
async function voiceApi(page) {
  let samples = [];
  await page.route('**/api/email-studio/voice-samples**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill(json({ samples, connected: ['outlook'] }));
    if (request.method() === 'DELETE') { samples = samples.filter(sample => sample.id !== new URL(request.url()).searchParams.get('id')); return route.fulfill(json({ samples })); }
    const body = request.postDataJSON() || {};
    if (body.action === 'scan') return route.fulfill(json({ provider: 'outlook', candidates: CANDIDATES }));
    samples = [...samples, ...saved(CANDIDATES.filter(item => (body.samples || []).some(sample => sample.body === item.body)))];
    return route.fulfill(json({ samples }));
  });
}

const steps = [
  { say: 'Abro «Tu voz» en «Firmas y estilo»', do: async c => {
    await voiceApi(c.page);
    await c.go('/settings/email-studio?tab=voz');
    await c.seeRole('heading', 'Firmas y estilo');
    await c.see('Aún no hay ejemplos tuyos', { timeout: 20000 });
    await c.seeRole('button', 'Buscar en mis enviados de Outlook');
    await c.see('La búsqueda corre solo cuando la pides');
  } },
  { say: 'Pido que busque en mis correos enviados', do: async c => {
    await c.click('Buscar en mis enviados de Outlook');
    await c.see('Encontramos 3 correos tuyos');
    c.check('los tres vienen marcados', (await c.page.getByRole('checkbox', { checked: true }).count()) === 3);
    await c.seeRole('button', 'Guardar 3 ejemplos');
  } },
  { say: 'Desmarco uno que no suena a mí y guardo', do: async c => {
    await c.clickOn(c.page.getByRole('checkbox').first());
    await c.click('Guardar 2 ejemplos');
    await c.see('2 de 5 ejemplos');
    c.check('quedan los dos elegidos', (await c.page.getByRole('list', { name: 'Tus ejemplos guardados' }).getByRole('listitem').count()) === 2);
    c.check('el que desmarqué no quedó', !(await c.has('Equipo para las aperturas')));
  } },
  { say: 'Quito uno', do: async c => {
    await c.clickOn(c.page.getByRole('button', { name: /Quitar el ejemplo «Lo que conversamos en la feria»/ }));
    await c.see('1 de 5 ejemplos');
  } },
];

export default () => [
  { id: 'tu-voz', persona: 'owner', title: 'Elijo correos míos para que la app escriba como yo', goal: 'Que mis borradores salgan con mi forma de escribir, eligiendo yo los ejemplos.', steps },
  { id: 'tu-voz-telefono', persona: 'owner', viewport: 'phone', title: 'Elijo correos míos desde el teléfono', goal: 'Lo mismo, en el teléfono.', steps },
];
