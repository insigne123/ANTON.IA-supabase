import type { CoworkArtifactData, CoworkCodeArtifact } from './code-artifact';

/**
 * Code artifacts written by hand with the `antonia` runtime (Plan 12, 3a). They show the writer
 * how a good one looks (3b puts them in its prompt), and the tests draw them in a real browser.
 * Each one reads every figure from `antonia.data`.
 */

export type CoworkArtifactExample = { id: string; title: string; brief: string; code: CoworkCodeArtifact; data: CoworkArtifactData };

const STAGES = ['Nuevo', 'Contactado', 'Reunión', 'Propuesta', 'Negociación', 'Ganado', 'Perdido'];
const COMPANIES = ['Minera Centinela', 'Retail Andes', 'Transportes Sur', 'Clínica Norte', 'Agrícola Valle', 'Securitas Chile', 'Banco Austral',
  'Logística Pacífico', 'Constructora Cumbre', 'Grupo Expro', 'Viña Alta', 'Frutícola del Maule', 'Puerto Central', 'Seguros Cordillera',
  'Pesquera Austral', 'Inmobiliaria Bahía', 'Farmacias Salud', 'Energía Solar Norte'];
const OWNERS = ['Nicolás', 'Camila', 'Felipe'];

/** A deterministic pipeline of 36 deals, as data.pipeline would read it. */
export function coworkExamplePipeline(): CoworkArtifactData {
  const rows = Array.from({ length: 36 }, (_, at) => {
    const stage = STAGES[(at * 5 + Math.floor(at / 7)) % STAGES.length];
    const month = 4 + (at % 6);
    return {
      company: COMPANIES[at % COMPANIES.length],
      stage,
      value: (3 + ((at * 37) % 41)) * 1_000_000,
      owner: OWNERS[at % OWNERS.length],
      created_at: `2026-${String(month).padStart(2, '0')}-${String(1 + ((at * 11) % 27)).padStart(2, '0')}`,
      close_date: `2026-${String(Math.min(12, month + 2)).padStart(2, '0')}-${String(1 + ((at * 7) % 27)).padStart(2, '0')}`,
    };
  });
  return { currency: 'CLP', tables: { pipeline: { label: 'Pipeline', source: 'CRM de ANTON.IA', total: rows.length, truncated: false,
    columns: [
      { key: 'company', label: 'Empresa', type: 'text' }, { key: 'stage', label: 'Etapa', type: 'text' },
      { key: 'value', label: 'Monto', type: 'money' }, { key: 'owner', label: 'Responsable', type: 'text' },
      { key: 'created_at', label: 'Creado', type: 'date' }, { key: 'close_date', label: 'Cierre', type: 'date' },
    ], rows } } };
}

/** 24 saved contacts with their fit score and what has been done with each, as data.contacts would read them. */
export function coworkExampleContacts(): CoworkArtifactData {
  const titles = ['Gerente de Operaciones', 'Jefa de RR. HH.', 'Gerente General', 'Subgerente Comercial', 'Jefe de Logística', 'Directora de Finanzas'];
  const names = ['Carlos Rivas', 'Nehal Soto', 'Marcela Díaz', 'Felipe Araya', 'José Castro', 'Paula Vega', 'Hugo Muñoz', 'Sofía Rojas',
    'Matías León', 'Daniela Pino', 'Andrés Lagos', 'Valentina Ríos'];
  const statuses = ['Sin contactar', 'Correo enviado', 'Respondió', 'Reunión'];
  const rows = Array.from({ length: 24 }, (_, at) => ({
    name: names[at % names.length] + (at >= names.length ? ' II' : ''),
    title: titles[at % titles.length],
    company: COMPANIES[(at * 3) % COMPANIES.length],
    industry: ['Minería', 'Retail', 'Transporte', 'Salud'][at % 4],
    fit: Math.round(40 + ((at * 23) % 60)),
    has_email: at % 5 !== 0,
    status: statuses[(at * 7) % statuses.length],
  }));
  return { tables: { contacts: { label: 'Contactos', source: 'Tus contactos guardados', total: rows.length, truncated: false,
    columns: [
      { key: 'name', label: 'Nombre', type: 'text' }, { key: 'title', label: 'Cargo', type: 'text' }, { key: 'company', label: 'Empresa', type: 'text' },
      { key: 'industry', label: 'Rubro', type: 'text' }, { key: 'fit', label: 'Calce', type: 'number' }, { key: 'has_email', label: 'Correo', type: 'text' },
      { key: 'status', label: 'Estado', type: 'text' },
    ], rows } } };
}

const PIPELINE: CoworkArtifactExample = {
  id: 'pipeline-por-etapa',
  title: 'Pipeline por etapa',
  brief: 'Tablero del pipeline: cifras arriba, monto por etapa, negocios creados por mes, reparto por responsable y la tabla de negocios.',
  data: coworkExamplePipeline(),
  code: {
    html: `<header class="header">
  <div><h1>Pipeline por etapa</h1><p>Negocios abiertos, monto por etapa y lo que viene a cierre.</p></div>
  <span class="badge badge-accent">Datos de tu CRM</span>
</header>
<section id="kpis" aria-label="Cifras del pipeline"></section>
<div class="grid-2" style="margin-top:16px">
  <section class="card" id="stages"></section>
  <section class="card" id="months"></section>
  <section class="card" id="owners"></section>
  <section class="card" id="mix"></section>
</div>
<section class="card" style="margin-top:16px">
  <h2>Negocios</h2>
  <div id="deals"></div>
</section>`,
    css: `#kpis { margin-bottom: 4px; }`,
    js: `const { agg, format } = antonia;
const deals = antonia.data.pipeline.rows;
const closed = deals.filter(d => d.stage === 'Ganado' || d.stage === 'Perdido');
const open = deals.filter(d => !closed.includes(d));
const won = deals.filter(d => d.stage === 'Ganado');

antonia.kpi('#kpis', [
  { label: 'Negocios abiertos', value: open.length },
  { label: 'Monto abierto', value: agg.sum(open, 'value'), unit: 'money' },
  { label: 'Ganados', value: won.length, hint: format.money(agg.sum(won, 'value')) },
  { label: 'Tasa de cierre', value: closed.length ? won.length / closed.length : null, unit: 'percent', hint: closed.length + ' cerrados' },
]);

const order = ['Nuevo', 'Contactado', 'Reunión', 'Propuesta', 'Negociación', 'Ganado'];
const byStage = agg.series(deals.filter(d => d.stage !== 'Perdido'), 'stage', { value: 'value', order });
antonia.chart('#stages', { type: 'funnel', title: 'Monto por etapa', note: 'Sin los perdidos', labels: byStage.labels, series: [{ name: 'Monto', values: byStage.values }], unit: 'money' });

const months = agg.byMonth(deals, 'created_at');
const wonByMonth = agg.byMonth(won, 'created_at');
antonia.chart('#months', { type: 'line', title: 'Negocios creados por mes', labels: months.labels,
  series: [{ name: 'Creados', values: months.values }, { name: 'Ganados', values: months.keys.map(key => wonByMonth.values[wonByMonth.keys.indexOf(key)] || 0) }] });

const owners = agg.groupBy(open, 'owner', { value: 'value' });
antonia.chart('#owners', { type: 'bar', title: 'Monto abierto por responsable', labels: owners.map(o => o.key), series: [{ name: 'Monto', values: owners.map(o => o.value) }], unit: 'money' });

const stagesByOwner = ['Nuevo', 'Contactado', 'Reunión', 'Propuesta', 'Negociación'];
antonia.chart('#mix', { type: 'stacked', title: 'Negocios abiertos por responsable y etapa', labels: owners.map(o => o.key),
  series: stagesByOwner.map(stage => ({ name: stage, values: owners.map(o => o.rows.filter(d => d.stage === stage).length) })) });

antonia.table('#deals', antonia.data.pipeline, { sortBy: 'value', pageSize: 10, caption: 'Negocios del pipeline' });`,
  },
};

const PROSPECTS: CoworkArtifactExample = {
  id: 'prospectos-priorizados',
  title: 'Prospectos priorizados',
  brief: 'Lista de prospectos ordenada por calce con tu cliente ideal, con filtros por rubro y estado, y a quién escribirle primero.',
  data: coworkExampleContacts(),
  code: {
    html: `<header class="header">
  <div><h1>A quién escribirle primero</h1><p>Tus contactos ordenados por calce con tu cliente ideal.</p></div>
</header>
<div class="grid-3" id="kpis"></div>
<section class="card" style="margin-top:16px">
  <div class="row" style="justify-content:space-between;margin-bottom:12px">
    <h2 style="margin:0">Prioridad</h2>
    <div class="row" role="group" aria-label="Filtrar por rubro" id="filters"></div>
  </div>
  <div id="list"></div>
</section>
<div class="grid-2" style="margin-top:16px">
  <section class="card" id="industries"></section>
  <section class="card" id="statuses"></section>
</div>`,
    css: `.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.fit { display: inline-flex; min-width: 40px; justify-content: flex-end; font-weight: 700; }`,
    js: `const { agg, h } = antonia;
const contacts = antonia.data.contacts.rows;
const ready = contacts.filter(c => c.has_email && c.status === 'Sin contactar');

antonia.kpi('#kpis', [
  { label: 'Contactos', value: contacts.length },
  { label: 'Listos para escribir', value: ready.length, hint: 'Con correo y sin contactar' },
  { label: 'Calce promedio', value: Math.round(agg.avg(contacts, 'fit')), hint: 'De 0 a 100' },
]);

const statusBadge = { 'Sin contactar': 'badge', 'Correo enviado': 'badge badge-accent', 'Respondió': 'badge badge-success', 'Reunión': 'badge badge-success' };
const columns = [
  { key: 'name', label: 'Nombre', type: 'text' },
  { key: 'title', label: 'Cargo', type: 'text' },
  { key: 'company', label: 'Empresa', type: 'text' },
  { key: 'fit', label: 'Calce', type: 'number', render: value => h('span', { class: 'fit num' }, String(value)) },
  { key: 'status', label: 'Estado', type: 'text', render: value => h('span', { class: statusBadge[value] || 'badge' }, value) },
];
let industry = 'Todos';
function renderList() {
  const rows = industry === 'Todos' ? contacts : contacts.filter(c => c.industry === industry);
  antonia.table('#list', rows, { columns, sortBy: 'fit', pageSize: 8, filterLabel: 'Buscar contacto' });
}
const industries = ['Todos'].concat(agg.groupBy(contacts, 'industry').map(g => g.key));
antonia.mount('#filters', industries.map(name => {
  const button = h('button', { type: 'button', class: 'btn chip', 'aria-pressed': String(name === industry) }, name);
  button.addEventListener('click', () => {
    industry = name;
    document.querySelectorAll('#filters .chip').forEach(chip => chip.setAttribute('aria-pressed', String(chip.textContent === name)));
    renderList();
  });
  return button;
}));
renderList();

const byIndustry = agg.series(contacts, 'industry');
antonia.chart('#industries', { type: 'donut', title: 'Contactos por rubro', labels: byIndustry.labels, series: [{ name: 'Contactos', values: byIndustry.values }] });
const byStatus = agg.series(contacts, 'status', { order: ['Sin contactar', 'Correo enviado', 'Respondió', 'Reunión'] });
antonia.chart('#statuses', { type: 'bar', title: 'En qué va cada uno', labels: byStatus.labels, series: [{ name: 'Contactos', values: byStatus.values }] });`,
  },
};

export const COWORK_ARTIFACT_EXAMPLES: CoworkArtifactExample[] = [PIPELINE, PROSPECTS];
