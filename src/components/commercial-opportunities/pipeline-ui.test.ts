import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as pipeline from '@/lib/commercial-opportunities/pipeline';
import * as priority from '@/lib/commercial-opportunities/priority';
import * as progress from '@/lib/commercial-opportunities/progress';
import * as summaries from '@/lib/commercial-opportunities/summaries';
import * as reportView from '@/lib/commercial-opportunities/report-view';

const require = createRequire(import.meta.url);
const compile = async (file: string) => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = {
  'lucide-react': new Proxy({}, { get: () => 'svg' }),
  '@/components/ui/button': { Button: ({ asChild, variant, size, ...props }: any) => React.createElement('button', props) },
  '@/components/initials-avatar': { InitialsAvatar: ({ name }: { name: string }) => React.createElement('span', { 'data-avatar': name }) },
  '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  '@/lib/commercial-opportunities/pipeline': pipeline,
  '@/lib/commercial-opportunities/priority': priority,
  '@/lib/commercial-opportunities/progress': progress,
  '@/lib/commercial-opportunities/summaries': summaries,
  '@/lib/commercial-opportunities/report-view': reportView,
};
const load = (code: string) => { const exports: any = {}; new Function('require', 'exports', code)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports); return exports; };
dependencies['./PipelineRoute'] = load(await compile('./PipelineRoute.tsx'));
dependencies['./PriorityStars'] = load(await compile('./PriorityStars.tsx'));
dependencies['./ProgressMarks'] = load(await compile('./ProgressMarks.tsx'));
const { PipelineBoard } = load(await compile('./PipelineBoard.tsx'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '').replace(/\s+/g, ' ');
const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
const item = (id: string, title: string, evaluation: string, deadline: string | null = later) => ({ id, kind: 'tender', title, company_name: null, buyer_name: 'Municipalidad', company_domain: null, url: null, score: 80,
  reasons: [], deadline_at: deadline, amount: null, currency: null, data: { evaluation }, updated_at: '2026-10-16T00:00:00Z' });
const items = [item('a', 'Aseo hospital', 'recommended', soon), item('b', 'Guardias museo', 'recommended'), item('c', 'Traslado de obras', 'recommended'), item('d', 'Software RR.HH.', 'review')];
const work = [{ opportunity_id: 'b', revision: 4, state: 'working', team_id: null, responsible_id: 'u1', assigned_by: null, objective: '', due_at: null, updated_at: '' },
  { opportunity_id: 'c', revision: 2, state: 'submitted', team_id: null, responsible_id: null, assigned_by: null, objective: '', due_at: null, updated_at: '' }];
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(PipelineBoard, { items, work, totals: { found: 40, recommended: 12 },
  members: [{ user_id: 'u1', name: 'Ana Soto' }], busy: false, suggestions: null, reviewing: false, onReview: () => {}, onMove: () => {}, onOpen: () => {}, ...props }));

test('the road has one stop per stage with its count, exact totals for what nobody works yet, and urgent closings flagged', () => {
  const html = render();
  for (const [label, count] of [['Por revisar', 40], ['Recomendadas', 12], ['Asignadas', 0], ['En preparación', 1], ['Presentadas', 1], ['Ganadas', 0]] as const)
    assert.match(html, new RegExp(`aria-label="${label}: ${count}"`), label);
  assert.match(text(html), /Recomendadas 1 cierra en menos de 7 días/, 'Aseo hospital closes in 3 days: said in words under the stop');
  assert.doesNotMatch(html, /bg-destructive px-1/, 'no red bubble without a meaning');
  assert.match(html, /<nav aria-label="Etapas de las oportunidades">/);
  // The first stage with opportunities is open below: its cards, closest closing first.
  assert.match(text(html), /Por revisar 40/);
  assert.match(text(html), /Se muestra 1 de 40, las de mayor prioridad\./);
  assert.match(text(html), /Licitación Cierra en/, 'each card says where it came from');
});

test('a stage with more than the page shows loads the next page, up to the most the server gives; then the search narrows it', () => {
  const html = render({ limits: { found: 60, recommended: 60 } });
  assert.match(text(html), /Cargar 39 más Quedan 39 en esta etapa\./);
  const atMost = render({ limits: { found: 600, recommended: 60 } });
  assert.doesNotMatch(text(atMost), /Cargar \d+ más/);
  assert.match(text(atMost), /Para ver las demás, búscalas por nombre o elige una fuente\./);
});

test('what is out of the road is a click away: lost, archived and the ones the AI left out, with their counts', () => {
  const html = render({ totals: { found: 40, recommended: 12, excluded: 340 } });
  assert.match(html, /<div role="group" aria-labelledby="pipeline-closed"[^>]*><span id="pipeline-closed"[^>]*>Fuera del embudo<\/span>/);
  assert.match(html, /<button type="button" aria-pressed="false" title="La IA las dejó fuera[^"]*" class="rounded-full border/, 'a chip that reads as a button, with what it holds');
  assert.match(text(html), /No recomendadas 340/);
  assert.doesNotMatch(text(html), /Perdidas|Archivadas/, 'only the ones with something');
});

test('the ones left out that are counted but not loaded yet say they are loading, not that none matches', () => {
  // Rendered on the server the board cannot pick a stage: the selection starts on the first busy one, so the excluded stage
  // is checked through its button and the empty «Por revisar» keeps its own message.
  const html = render({ items: [], work: [], totals: { found: 0, recommended: 0, excluded: 12 }, filtered: true });
  assert.match(text(html), /No recomendadas 12/);
});

test('with a search or a source on, an empty stage says the filters left it empty and offers to clear them', () => {
  const html = render({ items: [], work: [], totals: { found: 0, recommended: 0 }, filtered: true, onClearFilters: () => {} });
  assert.match(text(html), /Ninguna oportunidad de esta etapa coincide con la búsqueda o la fuente elegida\. Quitar filtros/);
  assert.match(text(render({ items: [], work: [], totals: { found: 0, recommended: 0 } })), /No hay oportunidades en esta etapa\./);
});

test('the AI suggestion sits on its card with the move to apply, and the summary says how many it moves', () => {
  const html = render({ suggestions: [{ id: 'b', move: 'submitted', reason: 'La nota dice que se subió la oferta.', nextAction: 'Confirmar recepción con el comprador' }] });
  assert.match(text(html), /La IA revisó 1 oportunidad en curso: sugiere mover 1/);
  assert.match(text(html), /Sugerir próximos pasos/);
  assert.match(html, /title="La IA revisa las 2 oportunidades en curso: propone a qué etapa moverlas y qué hacer después\. Nada cambia sin que lo aceptes\."/);
});

test('with nothing in progress there is nothing for the AI to review: no button; an empty stage stays quiet', () => {
  const html = render({ work: [] });
  assert.doesNotMatch(text(html), /Sugerir próximos pasos|Revisar con IA/);
  assert.match(html, /aria-label="Asignadas: 0"[^>]*><span class="[^"]*bg-background text-muted-foreground ring-border/);
});

test('the name of a stage is part of its button: what a person reads is what they click', () => {
  const html = render();
  for (const label of ['Por revisar', 'Recomendadas', 'Asignadas', 'En preparación', 'Presentadas', 'Ganadas'])
    assert.match(html, new RegExp(`<button[^>]*aria-label="${label}: \\d+"[^>]*>(?:(?!</button>).)*>${label}</span></button>`), label);
});

test('each card says what the opportunity is about under its name, with its buyer above and no dash when there is none', () => {
  const withSummary = [{ ...item('a', 'Aseo hospital', 'recommended', soon), data: { evaluation: 'recommended', summary: { text: 'Aseo diario de pabellones y salas del hospital regional.' } } },
    { ...item('e', 'SERVICIOS VIGILANCIA DSSA PP-65', 'recommended'), buyer_name: null }];
  const html = render({ items: withSummary, work: [] });
  assert.match(text(html), /Municipalidad Calce Aseo hospital Aseo diario de pabellones y salas del hospital regional\./);
  assert.doesNotMatch(text(html), /—/);
  assert.doesNotMatch(html, /animate-pulse/, 'nothing is on its way');
});

test('on a phone the cards fit the screen: the column can shrink below a long buyer name, which is cut with an ellipsis', () => {
  const html = render({ items: [{ ...item('a', 'SERVICIOS DE VIGILANCIA-GUARDIAS DRT VALPARAÍSO', 'recommended', soon), buyer_name: 'CORPORACION ADMINISTRATIVA DEL PODER JUDICIAL DE LA REGION' }], work: [] });
  // A lone card takes the whole row; two or more go side by side from lg up.
  assert.match(html, /<ul class="grid grid-cols-1 gap-3">/);
  assert.match(render({ items: [item('a', 'Aseo hospital', 'recommended', soon), item('b', 'Guardias', 'recommended', soon)], work: [] }), /<ul class="grid grid-cols-1 gap-3 lg:grid-cols-2">/);
  assert.match(html, /<li class="flex min-w-0 flex-col/);
  assert.match(html, /class="min-w-0 flex-1 truncate text-xs text-muted-foreground">CORPORACION ADMINISTRATIVA/);
});

test('while summaries are being written, the cards without one show a faint line instead of text', () => {
  const html = render({ items: [item('a', 'Aseo hospital', 'recommended', soon)], work: [], summariesWaiting: true });
  assert.match(html, /aria-hidden="true"><span class="block h-3 w-11\/12 rounded-full bg-muted motion-safe:animate-pulse"/);
  const left = render({ items: [{ ...item('a', 'Aseo hospital', 'recommended'), data: { evaluation: 'recommended', summary: { text: '' } } }], work: [], summariesWaiting: true });
  assert.doesNotMatch(left, /animate-pulse/, 'one the model left out shows no line');
});

// The cards are read by priority: stars say how well each fits, and the order follows them (priority.ts).
const rated = [{ ...item('a', 'Aseo hospital grande', 'recommended', later), score: 90 }, { ...item('b', 'Guardias museo urgente', 'recommended', soon), score: 82 },
  { ...item('c', 'Traslado de obras', 'recommended', new Date(Date.now() + 5 * 86_400_000).toISOString()), score: 55 }, { ...item('d', 'Fotocopias de oficina', 'recommended', new Date(Date.now() + 86_400_000).toISOString()), score: 20 }];
const order = (html: string) => [...html.matchAll(/<p class="line-clamp-2 font-medium leading-6">([^<]+)<\/p>/g)].map(match => match[1]);

test('each card shows one to five stars with what they mean in words, and the ones the AI left out show none', () => {
  const html = render({ items: rated, work: [] });
  assert.match(html, /role="img" aria-label="Calce 5 de 5: calza muy bien con tu oferta"/);
  assert.match(html, /aria-label="Calce 3 de 5: calza en parte: vale la pena revisarla"/);
  assert.match(html, /aria-label="Calce 1 de 5: calza muy poco con tu oferta"/);
  assert.equal((html.match(/role="img"/g) || []).length, 4, 'one group of stars per card');
  assert.match(text(html), /Las estrellas dicen qué tan bien calza cada una con tu oferta\./);
  // A card with a team keeps its stars; one the AI left out (here still shown through its work state) has none.
  const left = render({ items: [{ ...item('x', 'Descartada', 'excluded'), score: 4 }, { ...item('y', 'Otra', 'recommended'), score: 70 }],
    work: [{ opportunity_id: 'x', revision: 1, state: 'assigned', team_id: null, responsible_id: null, assigned_by: null, objective: '', due_at: null, updated_at: '' },
      { opportunity_id: 'y', revision: 1, state: 'assigned', team_id: null, responsible_id: null, assigned_by: null, objective: '', due_at: null, updated_at: '' }] });
  assert.equal((left.match(/role="img"/g) || []).length, 1);
  assert.match(left, /aria-label="Calce 4 de 5: calza bien con tu oferta"/);
});

test('by priority the most stars come first and, with the same stars, the one that closes first; by deadline the soonest', () => {
  assert.deepEqual(order(render({ items: rated, work: [] })), ['Guardias museo urgente', 'Aseo hospital grande', 'Traslado de obras', 'Fotocopias de oficina']);
  assert.deepEqual(order(render({ items: rated, work: [], sort: 'priority' })), ['Guardias museo urgente', 'Aseo hospital grande', 'Traslado de obras', 'Fotocopias de oficina']);
  assert.deepEqual(order(render({ items: rated, work: [], sort: 'deadline' })), ['Fotocopias de oficina', 'Guardias museo urgente', 'Traslado de obras', 'Aseo hospital grande']);
});

test('the order is a choice of two buttons that says which is on, says what each means, and the caption follows it', () => {
  const html = render({ items: rated, work: [], totals: { found: 0, recommended: 300 }, limits: { found: 60, recommended: 60 } });
  assert.match(html, /<div role="group" aria-label="Ordenar las oportunidades"/);
  assert.match(html, /aria-pressed="true"[^>]*title="Primero las que mejor calzan con tu oferta; con las mismas estrellas, las que cierran antes\."[^>]*>Prioridad</);
  assert.match(html, /aria-pressed="false"[^>]*title="Primero las que cierran antes; con la misma fecha, las que mejor calzan\."[^>]*>Cierran antes</);
  assert.match(text(html), /Se muestran 4 de 300, las de mayor prioridad\./);
  const byDeadline = render({ items: rated, work: [], totals: { found: 0, recommended: 300 }, sort: 'deadline' });
  assert.match(byDeadline, /aria-pressed="false"[^>]*>Prioridad</);
  assert.match(byDeadline, /aria-pressed="true"[^>]*>Cierran antes</);
  assert.match(text(byDeadline), /Se muestran 4 de 300, las que cierran antes\./);
});

test('with one card there is nothing to order, so the choice stays out of the way', () => {
  const html = render({ items: [rated[0]], work: [] });
  assert.doesNotMatch(html, /Ordenar las oportunidades/);
  assert.match(html, /role="img"/, 'the stars stay');
});

// What each card says of its own work, and the LinkedIn cards with something to read (progress.ts, summaries.ts).
test('a card says it is being researched, that its report is ready, and when this person opened it, so coming back is not coming back to nothing', () => {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const html = render({ items: rated, work: [],
    progress: { a: { research: 'running', researchAt: ago(2) }, b: { research: 'ready', researchAt: ago(30), reportAt: ago(28) }, c: { research: 'failed', researchAt: ago(5) }, d: { research: 'blocked' } },
    opened: { a: now - 60_000, b: now - 3 * 3_600_000, c: now - 10_000 } });
  assert.match(text(html), /Investigando… Abierta hace 1 min/);
  assert.match(text(html), /Informe listo · hace 28 min Abierta hace 3 h/);
  assert.match(text(html), /Investigación fallida Abierta recién/);
  assert.match(text(html), /Investigación detenida/);
  assert.match(html, /title="La investigación empezó hace 2 min\. Se actualiza sola\."/);
  assert.match(html, /animate-spin/, 'the one being researched has its spinner');
  const quiet = render({ items: rated, work: [] });
  assert.doesNotMatch(text(quiet), /Investigando|Informe listo|Abierta/, 'nothing happened to them: nothing said');
  assert.doesNotMatch(render({ items: [rated[3]], work: [], progress: { d: { research: 'running' } } }), /Abierta/);
});

test('a LinkedIn card shows what the screening found and how many ads stand behind it, instead of faint lines that never fill', () => {
  const jobs = 'Guardia de Seguridad Part Time · Santiago · https://x\nGuardia 4x4 · Providencia · https://y';
  const hiring = (id: string, reasons: string[]) => ({ ...item(id, `Actividad de contratación: Empresa ${id}`, 'review'), kind: 'hiring', buyer_name: `Empresa ${id}`, deadline_at: null, score: 60,
    reasons, data: { evaluation: 'review', description: jobs, observed: { ads: 6 } } });
  const html = render({ items: [hiring('a', ['Búsqueda de guardias para edificios; señal de dotación de seguridad.']), hiring('b', ['Pendiente de evaluación de afinidad'])], work: [], summariesWaiting: true });
  assert.match(text(html), /Búsqueda de guardias para edificios; señal de dotación de seguridad\./);
  assert.match(text(html), /Busca Guardia de Seguridad Part Time y Guardia 4x4\./, 'a generic reason gives way to the jobs');
  assert.match(text(html), /Avisos en LinkedIn 6 avisos/);
  assert.doesNotMatch(html, /animate-pulse/, 'neither waits for a summary');
  assert.match(text(render({ items: [{ ...hiring('c', []), data: { evaluation: 'review', description: jobs, observed: { ads: 1 } } }], work: [] })), /1 aviso(?!s)/);
  // A tender still waits for its summary, as before.
  assert.match(render({ items: [item('t', 'Guardias museo', 'review')], work: [], summariesWaiting: true }), /animate-pulse/);
  // With its summary written, that is what shows.
  const written = { ...hiring('w', ['motivo']), data: { evaluation: 'review', description: jobs, observed: { ads: 2 }, summary: { text: 'Dos avisos de guardias para edificios residenciales en Santiago.' } } };
  assert.match(text(render({ items: [written], work: [] })), /Dos avisos de guardias para edificios residenciales en Santiago\./);
});

test('a card nobody works yet offers «Asignar» to an administrator, in the list; without a way to assign there is the hint, as before', () => {
  const html = render({ onAssign: () => {} });
  // The first stage with opportunities is open: «Por revisar», where «Software RR.HH.» waits for a team.
  assert.match(html, /<button[^>]*>(?:(?!<\/button>).)*Asignar<\/button>/);
  assert.equal((html.match(/Asignar<\/button>/g) || []).length, 1, 'one card, one button');
  assert.doesNotMatch(text(html), /Asígnale un equipo para empezar/, 'the button says it');
  assert.equal(render({}).includes('Asignar</button>'), false);
  assert.match(text(render({})), /Asígnale un equipo para empezar/);
});

test('an administrator can say «No es para nosotros» from a card nobody works yet, and reopen what was put aside', () => {
  const html = render({ onAssign: () => {}, onDiscard: () => {} });
  assert.match(text(html), /Asignar No es para nosotros Abrir/, 'next to «Asignar», before opening it');
  assert.match(html, /title="Pasa a «Archivadas» con el motivo; la IA lo tendrá en cuenta\."/);
  assert.doesNotMatch(render({ onAssign: () => {} }), /No es para nosotros/, 'without the action, nothing offered');
  // What was put aside is out of the road, counted under «Archivadas» (its cards offer «Reabrir» once that chip is open).
  const archived = render({ items: [item('z', 'Aseo de oficinas', 'review')], work: [{ opportunity_id: 'z', revision: 3, state: 'archived', team_id: null, responsible_id: null, assigned_by: null, objective: '', due_at: null, updated_at: '' }],
    totals: { found: 0, recommended: 0, archived: 1 }, onReopen: () => {} });
  assert.match(text(archived), /Fuera del embudo Archivadas 1/);
  assert.doesNotMatch(text(archived), /Aseo de oficinas/, 'not among the ones nobody works');
});

test('the lost and the archived are counted by the server and load when opened; a card shows its amount, its region and the exact closing', () => {
  const closed = render({ items: [item('d', 'Software RR.HH.', 'review')], work: [], totals: { found: 1, recommended: 0, excluded: 0, lost: 2, archived: 140 } });
  assert.match(text(closed), /Perdidas 2/);
  assert.match(text(closed), /Archivadas 140/, 'the count of the server, though none is loaded');
  const rich = { ...item('m', 'Guardias para el museo', 'recommended'), amount: 48_000_000, currency: 'CLP', data: { evaluation: 'recommended', observed: { region: 'Valparaíso' } } };
  const html = render({ items: [rich], work: [] });
  assert.match(text(html), /\$48\s?M/);
  assert.match(html, /title="Monto: 48\.000\.000 CLP"/);
  assert.match(text(html), /Valparaíso/);
  assert.match(html, /title="Cierra el \d{1,2} de [a-z]+ de \d{4}, \d{2}:\d{2}"/, 'the exact day and hour, on the chip that says how many days');
  const uf = render({ items: [{ ...rich, amount: 1200, currency: 'UF' }], work: [] });
  assert.match(text(uf), /UF 1\.200/, 'below a million, the whole number');
});

test('the order also offers the largest amount first', () => {
  const html = render({ items: rated, work: [], sort: 'amount' });
  assert.match(html, /aria-pressed="true"[^>]*title="Primero las de mayor monto; las que no lo informan, al final\."[^>]*>Mayor monto</);
});

test('«Cierran esta semana» sits over the road: which ones close within seven days, the soonest first, each one a click away', () => {
  const hour = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  const week = [{ id: 'w1', title: 'Aseo hospital', deadlineAt: hour(1), stage: 'recommended' }, { id: 'w2', title: 'Guardias museo', deadlineAt: hour(100), stage: 'blocked' },
    { id: 'w3', title: 'Traslado de obras', deadlineAt: hour(120), stage: 'working' }];
  const html = render({ week });
  const words = text(html);
  assert.match(words, /Cierran esta semana (Hoy|Mañana) Aseo hospital · sin equipo [A-ZÁÉÍÓÚ][a-záéíóú]{2} \d{1,2} Guardias museo · bloqueada [A-ZÁÉÍÓÚ][a-záéíóú]{2} \d{1,2} Traslado de obras/);
  assert.ok(html.indexOf('Cierran esta semana') < html.indexOf('<nav aria-label="Etapas de las oportunidades">'), 'over the road');
  assert.match(html, /title="Aseo hospital · Cierra el [^"]+"/, 'the exact closing on hover');
  assert.doesNotMatch(text(render()), /Cierran esta semana/, 'nothing closing: no strip');
});
