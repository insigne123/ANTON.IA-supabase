// The user manual to read or print outside the app (docs/manual-de-usuario-antonia.html and .pdf), written from the same
// source as the Centro de ayuda: src/lib/help/manual.ts and the videos of src/lib/help/tutorial-videos.ts. Run it after
// changing the manual, so both say the same.
//
//   npm run manual:build            # the HTML
//   npm run manual:build -- --pdf   # and the PDF, with Playwright's Chromium (as the visual audit)
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIRST_EMAIL_PATH, HELP_GROUPS, HELP_SECTIONS, helpSectionById, type HelpSection } from '../../src/lib/help/manual';
import { formatVideoLength, videosForSection } from '../../src/lib/help/tutorial-videos';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HTML = path.join(ROOT, 'docs/manual-de-usuario-antonia.html');
const PDF = path.join(ROOT, 'docs/manual-de-usuario-antonia.pdf');

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FEATURE: Record<NonNullable<HelpSection['feature']>, string> = {
  opportunities: 'Para las cuentas con Oportunidades',
  admin: 'Para dueños y administradores',
  cowork: 'Para todas las cuentas',
};
const today = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).format(new Date());

function section(item: HelpSection) {
  const videos = videosForSection(item.id).filter(video => video.sections[0] === item.id);
  const related = (item.related || []).map(id => helpSectionById(id)).filter((other): other is HelpSection => Boolean(other));
  return `<section class="topic" id="${item.id}" aria-labelledby="${item.id}-title">
  <header class="topic-head">
    ${item.feature ? `<p class="eyebrow">${escape(FEATURE[item.feature])}</p>` : ''}
    <h2 id="${item.id}-title">${escape(item.title)}</h2>
    <p class="summary">${escape(item.summary)}</p>
    ${item.href ? `<p class="where">En el menú: <strong>${escape(item.title)}</strong> <span class="path">${escape(item.href)}</span></p>` : ''}
  </header>
  ${videos.map(video => `<figure class="video">
    <img src="../public/tutorial-videos/${video.id}.jpg" alt="" width="320" height="180" />
    <figcaption><span class="label">En video · ${formatVideoLength(video.seconds)}</span><strong>${escape(video.title)}</strong>${escape(video.summary)}
      <span class="hint">Míralo en la app: Centro de ayuda → «${escape(item.title)}».</span></figcaption>
  </figure>`).join('\n  ')}
  <h3>Paso a paso</h3>
  <ol class="steps">${item.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>
  ${item.tips?.length ? `<h3>Consejos</h3><ul class="tips">${item.tips.map(tip => `<li>${escape(tip)}</li>`).join('')}</ul>` : ''}
  <h3>Preguntas frecuentes</h3>
  <dl class="faqs">${item.faqs.map(faq => `<div><dt>${escape(faq.q)}</dt><dd>${escape(faq.a)}</dd></div>`).join('')}</dl>
  ${related.length ? `<p class="related">Sigue con: ${related.map(other => `<a href="#${other.id}">${escape(other.title)}</a>`).join(' · ')}</p>` : ''}
</section>`;
}

function page() {
  const groups = HELP_GROUPS.map(group => ({ group, sections: HELP_SECTIONS.filter(item => item.group === group) })).filter(entry => entry.sections.length);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Manual de usuario · ANTON.IA</title>
<style>
  :root { --ink: #1d1d1f; --muted: #5f6368; --line: #e3e5e8; --surface: #f5f6f8; --accent: #0b63ce; --accent-soft: #eaf2fd;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm 14mm 16mm; }
  html { background: #fff; }
  body { margin: 0; font-family: var(--font); color: var(--ink); background: #fff; line-height: 1.55; font-size: 15px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: 820px; margin: 0 auto; padding: 48px 20px 64px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .cover { padding-bottom: 28px; border-bottom: 1px solid var(--line); margin-bottom: 28px; }
  .brand { font-weight: 700; letter-spacing: .02em; color: var(--accent); margin: 0 0 18px; }
  h1 { font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 12px; text-wrap: balance; }
  .lead { font-size: 18px; color: var(--muted); max-width: 62ch; margin: 0 0 10px; }
  .stamp { font-size: 13px; color: var(--muted); margin: 0; }
  .path-first { background: var(--surface); border-radius: 18px; padding: 20px 24px; margin: 28px 0; }
  .path-first h2 { font-size: 18px; margin: 0 0 10px; }
  .path-first ol { margin: 0; padding-left: 20px; }
  .path-first li { margin: 6px 0; }
  nav.toc { columns: 2 260px; column-gap: 32px; margin-bottom: 8px; }
  nav.toc section { break-inside: avoid; margin-bottom: 16px; }
  nav.toc h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 6px; }
  nav.toc ol { list-style: none; margin: 0; padding: 0; }
  nav.toc li { margin: 3px 0; }
  .group { break-before: page; padding-top: 8px; }
  .group > h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); border-bottom: 1px solid var(--line);
    padding-bottom: 8px; margin: 32px 0 8px; }
  .topic { padding: 22px 0 28px; border-bottom: 1px solid var(--line); }
  .topic:last-child { border-bottom: 0; }
  .eyebrow { font-size: 12px; color: var(--muted); margin: 0 0 4px; }
  .topic h2 { font-size: 26px; letter-spacing: -0.01em; margin: 0 0 8px; break-after: avoid; }
  .summary { font-size: 16px; margin: 0 0 6px; max-width: 65ch; }
  .where { font-size: 13px; color: var(--muted); margin: 0; }
  .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: var(--surface); padding: 1px 6px; border-radius: 6px; }
  h3 { font-size: 15px; margin: 22px 0 8px; break-after: avoid; }
  .steps { margin: 0; padding-left: 22px; }
  .steps li { margin: 7px 0; padding-left: 4px; break-inside: avoid; max-width: 68ch; }
  .tips { margin: 0; padding-left: 20px; color: var(--ink); }
  .tips li { margin: 6px 0; break-inside: avoid; }
  .faqs { margin: 0; }
  .faqs div { padding: 10px 0; border-top: 1px solid var(--line); break-inside: avoid; }
  .faqs div:first-child { border-top: 0; }
  .faqs dt { font-weight: 600; margin-bottom: 2px; }
  .faqs dd { margin: 0; color: #3c4043; max-width: 68ch; }
  .video { display: flex; gap: 16px; align-items: flex-start; background: var(--accent-soft); border-radius: 16px; padding: 12px; margin: 16px 0 4px; break-inside: avoid; }
  .video img { width: 200px; max-width: 40%; height: auto; border-radius: 10px; flex-shrink: 0; }
  .video figcaption { font-size: 14px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .video .label { font-size: 12px; color: var(--accent); font-weight: 600; }
  .video .hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .related { font-size: 13px; color: var(--muted); margin: 16px 0 0; }
  footer { margin-top: 40px; font-size: 12px; color: var(--muted); }
  @media (max-width: 560px) { h1 { font-size: 30px; } .video { flex-direction: column; } .video img { max-width: 100%; width: 100%; } }
  @media print { main { padding: 0; } a { color: var(--ink); } }
</style>
</head>
<body>
<main>
  <header class="cover">
    <p class="brand">ANTON.IA</p>
    <h1>Manual de usuario</h1>
    <p class="lead">Cómo usar cada pantalla, paso a paso, con las preguntas más frecuentes. Es el mismo contenido del Centro de ayuda de la app: el botón «?» de cada pantalla y «Centro de ayuda» al final del menú.</p>
    <p class="stamp">Actualizado el ${today}. Si algo de la pantalla no calza con el manual, la pantalla manda.</p>
  </header>
  <section class="path-first" aria-labelledby="first-title">
    <h2 id="first-title">Tu camino al primer correo</h2>
    <ol>${FIRST_EMAIL_PATH.map(step => `<li><a href="#${step.section}"><strong>${escape(step.title)}</strong></a>: ${escape(step.text)}</li>`).join('')}</ol>
  </section>
  <nav class="toc" aria-label="Contenido">
    ${groups.map(entry => `<section><h3>${escape(entry.group)}</h3><ol>${entry.sections.map(item => `<li><a href="#${item.id}">${escape(item.title)}</a></li>`).join('')}</ol></section>`).join('\n    ')}
  </nav>
  ${groups.map(entry => `<div class="group"><h2>${escape(entry.group)}</h2>\n${entry.sections.map(section).join('\n')}</div>`).join('\n  ')}
  <footer>Generado desde el Centro de ayuda de ANTON.IA (scripts/user-manual/build.ts).</footer>
</main>
</body>
</html>
`;
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test', 'playwright-core'].filter(Boolean) as string[];
  try { candidates.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* npm missing */ }
  for (const candidate of candidates) {
    try { const mod = require(candidate); if (mod.chromium) return mod; } catch { /* next */ }
  }
  throw new Error('No encontré Playwright. Instálalo globalmente (npm i -g playwright) o indica su ruta en PLAYWRIGHT_MODULE.');
}

async function main() {
  writeFileSync(HTML, page());
  console.log(`[manual] ${path.relative(ROOT, HTML)}: ${HELP_SECTIONS.length} secciones.`);
  if (!process.argv.includes('--pdf')) return;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await loadPlaywright().chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(HTML).href, { waitUntil: 'load' });
    await page.pdf({ path: PDF, format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font:9px -apple-system,Segoe UI,Arial,sans-serif;color:#5f6368;width:100%;text-align:center">Manual de usuario · ANTON.IA · <span class="pageNumber"></span> de <span class="totalPages"></span></div>' });
    console.log(`[manual] ${path.relative(ROOT, PDF)}`);
  } finally { await browser.close(); }
}

main().catch(error => { console.error(`[manual] ${error.stack || error.message}`); process.exit(1); });
