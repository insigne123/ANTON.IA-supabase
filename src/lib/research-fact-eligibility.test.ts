import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGenericResearchText,
  isHardRejectedResearchUrl,
  isHardRejectedResearchText,
  isSensitiveEventText,
  mentionsResearchCompany,
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
