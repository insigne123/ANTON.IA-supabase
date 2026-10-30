import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGenericResearchText,
  isHardRejectedResearchUrl,
  isHardRejectedResearchText,
  isSensitiveEventText,
  isUnsuitableHookText,
  mentionsResearchCompany,
  withoutUnsuitableSentences,
} from './research-fact-eligibility';

test('hard-rejected challenge text cannot be diluted with substantive-looking padding', () => {
  const poisoned = [
    'Acme Logistics ofrece soluciones empresariales para operaciones regionales. '.repeat(12),
    'One moment, please... Loader Please wait while your request is being verified.',
  ].join(' ');

  assert.ok(poisoned.length > 320);
  assert.equal(isHardRejectedResearchText(poisoned), true);
  assert.equal(isGenericResearchText(poisoned), true);
  assert.equal(isHardRejectedResearchText('Verify you are human with hCaptcha before continuing.'), true);
  assert.equal(isHardRejectedResearchText('Just a moment...'), true);
  assert.equal(isHardRejectedResearchUrl('https://acme.example/cdn-cgi/challenge-platform/h/g/orchestrate'), true);
  assert.equal(isHardRejectedResearchText('Acme explica cómo reCAPTCHA ayuda a proteger formularios públicos.'), false);
});

test('hard-rejected research text excludes leaked HTML and static asset paths', () => {
  assert.equal(isHardRejectedResearchText('GrupoExpro <section class="elementor-section elementor-element-026ce62">'), true);
  assert.equal(isHardRejectedResearchText('com/wp-content/uploads/hummingbird-assets/09e805aff56cad98a711e'), true);
  assert.equal(isHardRejectedResearchText('doctype html> GrupoExpro | Te ayudamos a encontrar el trabajo que necesitas'), true);
  assert.equal(isHardRejectedResearchText('GrupoExpro ofrece servicios de reclutamiento y selección para distintas industrias.'), false);
});

test('a form, a robot check, a theme and a blog index are not facts about a company', () => {
  for (const junk of [
    'Psol Usuario Usuario Password Postulante Código Soporte Nombre(*) Telefono(*) Correo(*) Mensaje(*) Para comprobar que no es un bot, resuelva la adición: 2 + 7 +56930222085 Contacto Comercial Nombre(*) Empresa(*)',
    'Nombre(*) Correo(*) Mensaje(*)',
    'Para comprobar que no es un bot, resuelva la adición: 3 + 4',
    'Usuario Password Ingresar Recordarme',
    'A fully featured admin theme which can be used to build CRM, CMS, etc.',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
    '19 de Noviembre de 2024 Noticias , Psol , Tips muestra (0) PSOL reafirma su posición como líder en el mercado de software de selección y reclutamiento… Leer más Talento y experiencia en acción.',
    'Selección masiva: 3 desafíos claves y cómo superarlos con tecnología. Leer más Evaluaciones psicolaborales este 2025. Leer más',
  ]) {
    assert.equal(isHardRejectedResearchText(junk), true, junk);
    assert.equal(isGenericResearchText(junk), true, junk);
  }
  for (const fact of [
    'Los precios (*) incluyen IVA y pueden cambiar sin aviso.',
    'El usuario puede administrar su contraseña desde el portal de Acme.',
    'Acme abrió 10 vacantes en Lima. Leer más sobre el proceso está disponible en su portal de empleo.',
    'Acme explica cómo reCAPTCHA ayuda a proteger formularios públicos.',
    'Acme desarrolla un tema de administración para clínicas y publica sus novedades cada mes.',
  ]) assert.equal(isHardRejectedResearchText(fact), false, fact);
});

test('a death, an accident or a disaster is a sensitive event, the safety services a company sells are not', () => {
  for (const event of [
    'Pese a los esfuerzos desplegados por los equipos de emergencia, se constató el fallecimiento de ambos trabajadores.',
    'Con profundo pesar, Acme informa que fueron encontrados los dos trabajadores contratistas que permanecían desaparecidos.',
    'El accidente fatal ocurrió en la faena de Acme el lunes por la tarde.',
    'Acme lamenta la muerte de un trabajador contratista en su planta.',
    'La región enfrenta incendios forestales que han azotado la zona donde opera Acme.',
    'Two workers died in an accident at the Acme plant.',
  ]) assert.equal(isSensitiveEventText(event), true, event);
  for (const fact of [
    'Acme vende sistemas de protección contra incendios y capacita en prevención de accidentes laborales.',
    'Acme reduce los accidentes laborales con gestión de riesgos y turnos más seguros.',
    'Acme duplicó su producción y abrió 10 vacantes en Lima.',
    'Acme ofrece seguros de vida y de salud para empresas.',
    '',
  ]) assert.equal(isSensitiveEventText(fact), false, fact);
});

test('a gloss and the debate on the competition of the market are no reason to write, a fine, an inspection or a labour reform stay', () => {
  for (const text of [
    '—Who is who Aguas Andinas is the regulated utility that supplies drinking water, and Colina, Recoleta, Renca and Talagante are communes of the Santiago region.',
    'El backlog, conocido en el mercado como cartera pendiente por ejecutar, es un indicador de la evolución del negocio.',
    'La cartera de obras, conocida en el mercado como backlog, es un indicador de la evolución del negocio.',
    'La FNE recomendó ante la Comisión de Economía del Senado prohibir la participación de Gasco, Lipigas y Abastible en la distribución minorista.',
    'El Tribunal de Defensa de la Libre Competencia revisa una colusión en el mercado del gas licuado.',
    'Renca y Talagante son comunas de la Región Metropolitana.',
  ]) assert.equal(isUnsuitableHookText(text), true, text);
  for (const text of [
    'Acme abrió 10 vacantes de auxiliar de bodega en Lima y busca 5 operarios de planta en Arequipa.',
    'La Dirección del Trabajo fiscalizó tres faenas de Acme y cursó una multa por jornadas excesivas.',
    'La reforma laboral que reduce la jornada a 40 horas obliga a Acme a reorganizar sus turnos.',
    'Acme se adjudicó 16 contratos nuevos por UF 5,4 millones en el primer semestre.',
    'Acme presta servicios de agua potable y alcantarillado a la Región Metropolitana.',
    '',
  ]) assert.equal(isUnsuitableHookText(text), false, text);
});

test('what a company says of itself and the chrome of a document are no reason to write; a dated fact of its business stays', () => {
  // The shapes of what the research of 29 Oct 2026 offered as facts, with another company's name.
  for (const text of [
    'MANUAL CORPORATIVO - Código de Ética: ACME. DE SANTIAGO. MANUAL CORPORATIVO. Código de Ética. ACME S.A.. Gerencia General.',
    'TÉRMINOS DE REFERENCIA: EMPRESA DE TRANSPORTE. ACME S.A.. SUBGERENCIA DE PROYECTOS OPERACIONALES. CONSTRUCCIÓN DE SALAS ...',
    'Página 1 de 66: asesoría para Acme S.A.: Póliza de Incendio de Edificios y Contenidos, con una vigencia de 12 meses ...',
    '11472+ Otras Ocupaciones Concepcion Acme Ingenieria Jobs in ...: 11472+ otras ocupaciones jobs in Chile — October 2026 openings at top companies.',
    'Nuestra misión es maximizar el valor económico, ambiental y social de Acme de manera sostenible.',
    'En Acme nos moviliza la transparencia. Acá puedes acceder a nuestros resultados financieros.',
    '000 metros sobre el nivel del mar. Es un yacimiento de explotación a rajo abierto.',
    'En Acme Chile, la seguridad de la información es parte de nuestra cultura.',
    'Política general del sistema de gestión de seguridad de la información',
    'La información es uno de los activos más valiosos de cualquier organización, y en Acme lo sabemos bien.',
    'Conoce cómo gestionamos este compromiso a través de una política clara.',
    'La importancia de los Descriptores de Cargo para el éxito organizacional',
    'En Chile, los Servicios Transitorios están regulados por la Ley N° 20.123 sobre Contrato de Trabajo de Personal Transitorio.',
    'El período de cobertura está vinculado a la naturaleza de la causal que justifica el servicio transitorio.',
    '¿Por qué trabajar en minería? Estos son los 5 atributos ...: Minería consolida su atractivo laboral en Chile.',
    '¿Tienes dudas? ¿Quieres saber más de Acme? Contáctate con nosotros.',
    'Ana Pérez - División Norte: ... ACME – Corporación de Chile · Educación: Universidad ... Ana Pérez en LinkedIn',
    'Juan Soto: Experiencia: Constructora Acme · Educación: Universidad Andrés Bello · Ubicación: Área metropolitana de Rancagua',
    '4 perfiles de «Luis Rojas»: ... Luis Rojas que usan LinkedIn para ... Gerente de Recursos Humanos en Acme',
    'Sigue leyendo → VIDEOS | 4 julio, 2024 Operativo de limpieza de playa junto a Acme Sigue leyendo → VIDEOS | 2 abril, 2024',
  ]) assert.equal(isUnsuitableHookText(text), true, text);
  for (const text of [
    'Abrirán dos tiendas nuevas en la zona sur antes de diciembre (nota de prensa, 2026-09-10).',
    'Acme mantiene 10 vacantes abiertas para conductores en Antofagasta y Atacama.',
    'Publicaron 12 empleos de operarios de bodega en las últimas tres semanas.',
    'ACME y ENAP firmaron un acuerdo de suministro por 5 años.',
    'Acme cuenta con un equipo de consultores con experiencia en selección de personal para puestos ejecutivos.',
    // The recipient's own profile and a snippet with a real signal stay.
    'Eric Rojas - Jefe de Adquisiciones Proyectos en Acme ...: Jefe de Adquisiciones Proyectos en Acme · Ingeniero Civil Industrial',
    'Estaremos presentes en feria laboral de Antofagasta para ...: Estaremos presentes en feria laboral de Antofagasta para acercar nuevas oportunidades de empleo.',
  ]) assert.equal(isUnsuitableHookText(text), false, text);
});

test('a fact loses its unsuitable sentences and keeps the rest, and is empty when nothing is left', () => {
  assert.equal(
    withoutUnsuitableSentences('Acme se adjudicó 16 contratos nuevos por UF 5,4 millones. El backlog, conocido en el mercado como cartera pendiente, mide lo que falta por ejecutar. Esto abre obras en Antofagasta.'),
    'Acme se adjudicó 16 contratos nuevos por UF 5,4 millones. Esto abre obras en Antofagasta.',
  );
  assert.equal(withoutUnsuitableSentences('  Acme abrió 10 vacantes.   Acme busca 5 operarios.  '), 'Acme abrió 10 vacantes. Acme busca 5 operarios.');
  assert.equal(withoutUnsuitableSentences('La FNE recomendó prohibir la participación de Acme.'), '');
  // A figure with a thousands separator or a legal form is not cut in the middle, and what is left must say something.
  assert.equal(withoutUnsuitableSentences('Acme se adjudicó contratos por 5.400 millones, según la FNE. Opera en tres regiones.'), 'Opera en tres regiones.');
  assert.equal(withoutUnsuitableSentences('Acme S.A. fue citada por la FNE. Abrió.'), '');
  assert.equal(withoutUnsuitableSentences('Acme abrió sucursal'), 'Acme abrió sucursal');
  assert.equal(withoutUnsuitableSentences(''), '');
  assert.equal(withoutUnsuitableSentences(undefined), '');
});

test('ordinary navigation remains a conservative length-bounded generic filter', () => {
  assert.equal(isGenericResearchText('Skip to main content'), true);
  assert.equal(isGenericResearchText(`${'Acme publishes useful operational context. '.repeat(12)} Skip to main content`), false);
});

test('mentionsResearchCompany accepts the company name in its actual order', () => {
  assert.equal(mentionsResearchCompany(
    'Industrias San Miguel amplió su operación regional.',
    { companyName: 'Industrias San Miguel', companyDomain: 'ism.global' },
  ), true);
});

test('mentionsResearchCompany rejects a different company with the same reordered words', () => {
  assert.equal(mentionsResearchCompany(
    'San Miguel Industrias PET opera una planta de reciclaje botella a botella.',
    { companyName: 'Industrias San Miguel', companyDomain: 'ism.global' },
  ), false);
});

test('mentionsResearchCompany rejects a different company with extra identity terms', () => {
  assert.equal(mentionsResearchCompany(
    'Banco Nacional de Chile publicó sus resultados.',
    { companyName: 'Banco de Chile', companyDomain: 'bancochile.cl' },
  ), false);
});

test('mentionsResearchCompany tolerates omitted legal suffixes', () => {
  assert.equal(mentionsResearchCompany(
    'Acme Logistics presentó su nueva operación.',
    { companyName: 'Acme Logistics SpA', companyDomain: 'acme-logistics.example' },
  ), true);
});

test('mentionsResearchCompany still accepts the verified company domain', () => {
  assert.equal(mentionsResearchCompany(
    'Más información en https://www.ism.global/nuestra-historia',
    { companyName: 'Industrias San Miguel', companyDomain: 'ism.global' },
  ), true);
});
