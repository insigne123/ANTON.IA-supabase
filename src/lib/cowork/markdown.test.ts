import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownExcerpt, markdownInlineText, parseMarkdown, parseMarkdownInline, safeMarkdownHref } from './markdown';

test('parses headings, paragraphs with line breaks and inline emphasis', () => {
  const blocks = parseMarkdown('# Informe semanal\n\nTexto con **negrita**, *cursiva*, ~~tachado~~ y `código`.\nSegunda línea');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].type === 'heading' && blocks[0].level, 1);
  const paragraph = blocks[1];
  assert.equal(paragraph.type, 'paragraph');
  if (paragraph.type !== 'paragraph') return;
  const kinds = paragraph.children.map(node => node.type);
  assert.deepEqual(kinds, ['text', 'strong', 'text', 'em', 'text', 'del', 'text', 'code', 'text', 'br', 'text']);
  assert.equal(markdownInlineText(paragraph.children), 'Texto con negrita, cursiva, tachado y código.\nSegunda línea');
});

test('parses GFM tables with alignment, escaped pipes and <br> in cells', () => {
  const blocks = parseMarkdown('| Contacto | Empresa | Tasa |\n|:---|:---:|---:|\n| Ana | Logística **Sur** | 12% |\n| Luis \\| Jr | Retail<br>Norte | 3% |');
  const table = blocks[0];
  assert.equal(table.type, 'table');
  if (table.type !== 'table') return;
  assert.deepEqual(table.align, ['left', 'center', 'right']);
  assert.equal(table.rows.length, 2);
  assert.equal(markdownInlineText(table.rows[1][0]), 'Luis | Jr');
  assert.ok(table.rows[1][1].some(node => node.type === 'br'));
  assert.ok(table.rows[0][1].some(node => node.type === 'strong'));
});

test('parses nested and ordered lists, task items and interrupting lists', () => {
  const blocks = parseMarkdown('Prioridades:\n- Responder a Rafael\n  - Proponer horario\n- [x] Revisar rebotes\n\n3. Tercero\n4. Cuarto');
  assert.equal(blocks[0].type, 'paragraph');
  const list = blocks[1];
  assert.equal(list.type, 'list');
  if (list.type !== 'list') return;
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].children[1]?.type, 'list', 'nested list stays inside the first item');
  assert.equal(list.items[1].checked, true);
  const ordered = blocks[2];
  assert.equal(ordered.type === 'list' && ordered.ordered, true);
  assert.equal(ordered.type === 'list' && ordered.start, 3);
});

test('code fences, quotes and thematic breaks', () => {
  const blocks = parseMarkdown('> Cita\n> segunda\n\n```python\nprint("hola")\n```\n\n---\nFin');
  assert.deepEqual(blocks.map(block => block.type), ['blockquote', 'code', 'hr', 'paragraph']);
  const code = blocks[1];
  assert.equal(code.type === 'code' && code.lang, 'python');
  assert.equal(code.type === 'code' && code.value, 'print("hola")');
});

test('never keeps unsafe links or raw HTML', () => {
  assert.equal(safeMarkdownHref('javascript:alert(1)'), null);
  assert.equal(safeMarkdownHref('//evil.example'), null);
  assert.equal(safeMarkdownHref('https://user:pass@example.com'), null);
  assert.equal(safeMarkdownHref('/contact/compose?draftId=1'), '/contact/compose?draftId=1');
  const nodes = parseMarkdownInline('[clic](javascript:alert(1)) <script>alert(1)</script> https://example.com/a).');
  assert.equal(nodes.some(node => node.type === 'link' && node.href.startsWith('javascript')), false);
  assert.match(markdownInlineText(nodes), /<script>alert\(1\)<\/script>/);
  const link = nodes.find(node => node.type === 'link');
  assert.equal(link?.type === 'link' && link.href, 'https://example.com/a');
});

test('snake_case words and lone asterisks stay literal', () => {
  const text = markdownInlineText(parseMarkdownInline('usa lead_id y 2 * 3 = 6'));
  assert.equal(text, 'usa lead_id y 2 * 3 = 6');
});

test('pathological input stays fast', () => {
  const started = Date.now();
  parseMarkdown('**a '.repeat(10000) + '\n' + '_b '.repeat(10000) + '\n' + '['.repeat(5000));
  assert.ok(Date.now() - started < 1500, 'bounded parse time');
});

test('excerpt skips markup', () => {
  assert.equal(markdownExcerpt('# Título\n\n**Resumen:** tres cuentas prioritarias.', 60), 'Título Resumen: tres cuentas prioritarias.');
});

test('a closing line under a list is its own paragraph; a wrapped item still continues', () => {
  const closing = parseMarkdown('Para avanzar:\n- 3 de tus 4 contactos no tienen correo.\n- Hay 2 incidencias abiertas.\n¿Busco el correo de esos 3 contactos?');
  assert.deepEqual(closing.map(block => block.type), ['paragraph', 'list', 'paragraph']);
  const list = closing[1];
  assert.equal(list.type === 'list' && list.items.length, 2);
  const question = closing[2];
  assert.equal(question.type === 'paragraph' && markdownInlineText(question.children), '¿Busco el correo de esos 3 contactos?');
  // Without a sentence end the next line is the same item, wrapped.
  const wrapped = parseMarkdown('- Revisar a Carlos de Minera\nCentinela y a Nehal de Adecco.');
  assert.deepEqual(wrapped.map(block => block.type), ['list']);
  const item = wrapped[0].type === 'list' ? wrapped[0].items[0].children[0] : null;
  assert.equal(item?.type === 'paragraph' && markdownInlineText(item.children), 'Revisar a Carlos de Minera\nCentinela y a Nehal de Adecco.');
});
