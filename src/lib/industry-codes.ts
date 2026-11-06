/**
 * The sector of a company from its NAICS or SIC codes, in Spanish. Apollo's company search no longer returns `industry`,
 * the headcount or the city (docs.apollo.io, Organization Search, checked 6 Nov 2026), but it carries `naics_codes` and
 * `sic_codes` when it has them, at no extra cost. Pure: the gateway, Cowork and the tests share it.
 */

/** NAICS 2017, the levels a salesperson recognizes: the 4- and 3-digit groups worth telling apart, then the 2-digit sectors. */
const NAICS: Array<[string, string]> = [
  ['7211', 'Hotelería y alojamiento'], ['7223', 'Servicios de alimentación y catering'], ['722', 'Restaurantes y servicios de comida'],
  ['721', 'Hotelería y alojamiento'], ['5613', 'Servicios de personal y empleo'], ['5616', 'Seguridad e investigaciones'],
  ['5617', 'Servicios a edificios y aseo'], ['4931', 'Bodegaje y almacenamiento'], ['484', 'Transporte por camión'],
  ['488', 'Servicios de apoyo al transporte'], ['445', 'Supermercados y comercio de alimentos'], ['311', 'Industria alimentaria'],
  ['312', 'Bebidas y tabaco'], ['2121', 'Minería del carbón'], ['2122', 'Minería metálica'], ['1141', 'Pesca'], ['1125', 'Acuicultura'],
  ['11', 'Agricultura, ganadería, silvicultura y pesca'], ['21', 'Minería'], ['22', 'Electricidad, agua y gas'], ['23', 'Construcción'],
  ['31', 'Manufactura'], ['32', 'Manufactura'], ['33', 'Manufactura'], ['42', 'Comercio mayorista'], ['44', 'Comercio minorista'],
  ['45', 'Comercio minorista'], ['48', 'Transporte y logística'], ['49', 'Transporte y logística'], ['51', 'Medios, información y telecomunicaciones'],
  ['52', 'Finanzas y seguros'], ['53', 'Inmobiliario y arriendos'], ['54', 'Servicios profesionales y técnicos'], ['55', 'Administración de empresas'],
  ['56', 'Servicios de apoyo a empresas'], ['61', 'Educación'], ['62', 'Salud y asistencia social'], ['71', 'Entretención y recreación'],
  ['72', 'Hotelería y servicios de comida'], ['81', 'Otros servicios'], ['92', 'Administración pública'],
];

/** SIC 1987, by major group: the older code, kept when NAICS is missing. */
const SIC: Array<[number, number, string]> = [
  [100, 999, 'Agricultura, ganadería, silvicultura y pesca'], [1000, 1499, 'Minería'], [1500, 1799, 'Construcción'],
  [2000, 2099, 'Industria alimentaria'], [2100, 3999, 'Manufactura'], [4200, 4299, 'Transporte y logística'],
  [4000, 4799, 'Transporte y logística'], [4800, 4899, 'Medios, información y telecomunicaciones'], [4900, 4999, 'Electricidad, agua y gas'],
  [5000, 5199, 'Comercio mayorista'], [5400, 5499, 'Supermercados y comercio de alimentos'], [5800, 5899, 'Restaurantes y servicios de comida'],
  [5200, 5999, 'Comercio minorista'], [6000, 6499, 'Finanzas y seguros'], [6500, 6799, 'Inmobiliario y arriendos'],
  [7000, 7099, 'Hotelería y alojamiento'], [7360, 7369, 'Servicios de personal y empleo'], [7380, 7389, 'Servicios de apoyo a empresas'],
  [7300, 7399, 'Servicios a empresas'], [7900, 7999, 'Entretención y recreación'], [8000, 8099, 'Salud y asistencia social'],
  [8200, 8299, 'Educación'], [8700, 8799, 'Servicios profesionales y técnicos'], [7000, 8999, 'Otros servicios'], [9100, 9799, 'Administración pública'],
];

/** The digits of each code, at most ten: Apollo sends them as strings, sometimes as numbers. */
export function industryCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(typeof item === 'number' || typeof item === 'string' ? item : '').trim())
    .filter(code => /^\d{2,6}$/.test(code)))].slice(0, 10);
}

function naicsSector(code: string) {
  return NAICS.find(([prefix]) => code.startsWith(prefix))?.[1] ?? null;
}

function sicSector(code: string) {
  const number = Number(code.slice(0, 4).padEnd(4, '0'));
  return SIC.find(([from, to]) => number >= from && number <= to)?.[2] ?? null;
}

/** «Hotelería y alojamiento» for NAICS 721110; null when neither code says anything. NAICS first: it is the finer one. */
export function sectorFromIndustryCodes(input: { naics?: unknown; sic?: unknown }): string | null {
  for (const code of industryCodes(input.naics)) {
    const sector = naicsSector(code);
    if (sector) return sector;
  }
  for (const code of industryCodes(input.sic)) {
    const sector = sicSector(code);
    if (sector) return sector;
  }
  return null;
}
