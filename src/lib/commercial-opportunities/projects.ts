import { chileanRegion } from './hiring';

/**
 * Investment projects of the SEIA (plan 8, phase 3, PR-3e): the export of the SEA project map (sig.sea.gob.cl/mapadeproyectos,
 * CSV) uploaded by the person, read into projects and matched against the sectors, regions and minimum investment of the
 * search profile. The company that owns the project (the «titular») becomes a company to reach with «Buscar decisores».
 * The map has no public API: its data service asks for a token of its own page, so the file is uploaded by hand each month.
 */
export type SeiaProject = {
  id: string;
  name: string;
  owner: string | null;
  presentation: 'DIA' | 'EIA' | null;
  typologyLetter: string | null;
  typology: string | null;
  region: string | null;
  communes: string | null;
  state: string | null;
  presentedAt: string | null;
  qualifiedAt: string | null;
  investmentMusd: number | null;
  url: string | null;
};
export type ProjectProfile = { sectors: string[]; regions: string[]; minInvestmentUsd: number | null };

/** The productive sectors of the SEIA, by the letter of article 3 of its regulation and the words of the typology. */
export const SEIA_SECTORS: Array<{ id: string; label: string; letters: string[]; words: string[] }> = [
  { id: 'mineria', label: 'Minería', letters: ['i'], words: ['miner', 'extraccion', 'yacimiento', 'relave'] },
  { id: 'energia', label: 'Energía', letters: ['b', 'c', 'j'], words: ['energia', 'electric', 'central', 'transmision', 'fotovoltaic', 'eolic', 'solar', 'gasoducto', 'oleoducto'] },
  { id: 'inmobiliario', label: 'Inmobiliario y urbano', letters: ['g', 'h'], words: ['inmobiliari', 'urbano', 'vivienda', 'habitacional', 'turistic'] },
  { id: 'infraestructura', label: 'Infraestructura', letters: ['a', 'e', 'f'], words: ['puerto', 'portuari', 'camino', 'autopista', 'aeropuerto', 'ferroviari', 'embalse', 'acueducto'] },
  { id: 'industria', label: 'Industria y bodegaje', letters: ['k', 'ñ'], words: ['industrial', 'fabril', 'planta', 'bodega', 'almacenamiento'] },
  { id: 'agroindustria', label: 'Agroindustria y alimentos', letters: ['l'], words: ['agroindustri', 'matadero', 'lacteo', 'frutic', 'alimento', 'vitivinicol'] },
  { id: 'forestal', label: 'Forestal y celulosa', letters: ['m'], words: ['forestal', 'celulosa', 'aserradero'] },
  { id: 'acuicultura', label: 'Acuicultura y pesca', letters: ['n'], words: ['acuicultura', 'salmon', 'pesca', 'piscicultura'] },
  { id: 'saneamiento', label: 'Saneamiento y residuos', letters: ['o'], words: ['saneamiento', 'residuo', 'relleno sanitario', 'tratamiento de agua'] },
];
export const PILOT_SEIA_SECTORS = ['mineria', 'energia', 'inmobiliario', 'infraestructura', 'industria', 'agroindustria'];

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const key = (value: string) => fold(value).replace(/[^a-z0-9]/g, '');
const text = (value: unknown, max = 500) => (value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim().slice(0, max));

/** The columns of the export, by the field name of the map or by a readable header («Nombre del proyecto», «Inversión (MMU$)»). */
const COLUMNS: Record<keyof Omit<SeiaProject, 'presentation' | 'typologyLetter' | 'investmentMusd'> | 'presentation' | 'letter' | 'investment', string[]> = {
  id: ['idexpediente', 'expediente', 'id', 'idproyecto', 'codigo'],
  name: ['nombreproyecto', 'nombredelproyecto', 'nombre', 'proyecto'],
  owner: ['titular', 'nombretitular', 'empresa'],
  presentation: ['formapresentacion', 'formadepresentacion', 'tipo', 'tipopresentacion'],
  letter: ['letratipologia', 'tipologialetra'],
  typology: ['nombretipologia', 'tipologia', 'sectorproductivo', 'sector'],
  region: ['region'],
  communes: ['comunas', 'comuna'],
  state: ['estadoevaluacion', 'estado', 'estadoactual'],
  presentedAt: ['fechapresentacion', 'fechadepresentacion', 'presentacion', 'fechaingreso'],
  qualifiedAt: ['fechacalificacion', 'fechadecalificacion'],
  investment: ['inversionus', 'inversionmmus', 'inversionmmu', 'inversion', 'inversionmillonesdeus', 'montoinversion'],
  url: ['urlexpediente', 'url', 'enlace', 'link'],
};

/** «12/08/2026», «2026-08-12» or an Excel serial day to an ISO date, or null. */
function dateOf(value: unknown) {
  const raw = text(value, 40);
  if (!raw) return null;
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  const chilean = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (chilean) return `${chilean[3]}-${chilean[2].padStart(2, '0')}-${chilean[1].padStart(2, '0')}`;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
/** «1.250,5», «1250.5» or «US$ 320» to a number of millions of dollars. */
function millionsOf(value: unknown) {
  const raw = text(value, 40).replace(/[^\d.,-]/g, '');
  if (!raw) return null;
  const normalized = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** The rows of the export (header names as they come) to projects; rows without a name or an id are skipped and counted. */
export function parseSeiaRows(rows: Array<Record<string, unknown>>) {
  const projects: SeiaProject[] = [];
  let skipped = 0;
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const column = (field: keyof typeof COLUMNS) => headers.find(header => COLUMNS[field].includes(key(header)));
  const pick = Object.fromEntries((Object.keys(COLUMNS) as Array<keyof typeof COLUMNS>).map(field => [field, column(field)])) as Record<keyof typeof COLUMNS, string | undefined>;
  if (!pick.name) return { projects, skipped: rows.length, missingColumns: ['nombre del proyecto'] };
  for (const row of rows) {
    const get = (field: keyof typeof COLUMNS) => (pick[field] ? row[pick[field]!] : undefined);
    const name = text(get('name'), 500);
    const id = text(get('id'), 60) || (name ? `${key(name).slice(0, 80)}|${key(text(get('owner'), 120)).slice(0, 40)}` : '');
    if (!name || !id) { skipped++; continue; }
    const presentation = fold(text(get('presentation'), 20)).toUpperCase();
    const url = text(get('url'), 2000);
    const letter = text(get('letter'), 6).toLowerCase();
    projects.push({
      id, name, owner: text(get('owner'), 300) || null,
      presentation: presentation.includes('EIA') ? 'EIA' : presentation.includes('DIA') ? 'DIA' : null,
      typologyLetter: letter ? letter.charAt(0) : null, typology: text(get('typology'), 300) || null,
      region: chileanRegion(text(get('region'), 120)) ?? (text(get('region'), 120) || null), communes: text(get('communes'), 200) || null,
      state: text(get('state'), 60) || null, presentedAt: dateOf(get('presentedAt')), qualifiedAt: dateOf(get('qualifiedAt')),
      investmentMusd: millionsOf(get('investment')), url: /^https?:\/\//i.test(url) ? url : null,
    });
  }
  return { projects, skipped, missingColumns: [] as string[] };
}

export function projectSector(project: Pick<SeiaProject, 'typologyLetter' | 'typology' | 'name'>) {
  const words = fold(`${project.typology || ''} ${project.name}`);
  return SEIA_SECTORS.find(sector => (project.typologyLetter && sector.letters.includes(project.typologyLetter)))
    ?? SEIA_SECTORS.find(sector => sector.words.some(word => words.includes(word))) ?? null;
}

/** «No admitido a tramitación» or «No calificado» are not alive even if they name an evaluation step. */
const DEAD = /(^|\s)no\s|rechaz|desist|revoc|caduc|abandon|termin|extingu/;
const LIVE = /calificacion|aprobad|tramitacion/;
const DAY = 86_400_000;
const monthDay = new Intl.DateTimeFormat('es-CL', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Whether a project may need people soon, and how much (0 to 100, with reasons): in evaluation or approved, of a chosen sector,
 * over the minimum investment and presented in the last two years. Rejected, withdrawn or older ones never fit.
 */
export function matchProject(project: SeiaProject, profile: ProjectProfile, now: string) {
  const state = fold(project.state || '');
  if (DEAD.test(state) || !LIVE.test(state)) return null;
  const sector = projectSector(project);
  if (profile.sectors.length && (!sector || !profile.sectors.includes(sector.id))) return null;
  const musd = project.investmentMusd;
  if (profile.minInvestmentUsd && (musd === null || musd * 1_000_000 < profile.minInvestmentUsd)) return null;
  const presented = project.presentedAt ? Date.parse(`${project.presentedAt}T12:00:00Z`) : NaN;
  const age = Number.isFinite(presented) ? (Date.parse(now) - presented) / DAY : null;
  if (age !== null && age > 730) return null;
  const reasons: string[] = [];
  let score = 0;
  if (musd !== null) {
    score += musd >= 500 ? 40 : musd >= 100 ? 30 : musd >= 10 ? 20 : 10;
    reasons.push(`US$ ${musd.toLocaleString('es-CL', { maximumFractionDigits: 1 })} millones`);
  }
  if (/calificacion/.test(state)) { score += 25; reasons.push('en calificación: aún no se construye'); }
  else { score += 20; reasons.push('aprobado'); }
  if (age !== null) {
    if (age <= 182) score += 15; else if (age <= 365) score += 8;
    reasons.push(`presentado en ${monthDay.format(new Date(presented)).replace('.', '')}`);
  }
  if (sector) { score += 10; reasons.push(sector.label); }
  if (project.region && profile.regions.some(region => fold(region) === fold(project.region!))) { score += 10; reasons.push(`en ${project.region}`); }
  if (project.presentation === 'EIA') reasons.push('estudio de impacto (EIA): proyecto grande');
  return { score: Math.min(100, score), reasons, sector: sector?.id ?? null };
}
