// The preview backend: each laid out page as an SVG, from the very operations the PDF is written with. It is what a reviewer (a person, or a model
// that reads images) looks at when no PDF rasterizer is at hand, and what the tests read to check what is drawn where. Pure.
import type { Font, Layout, LaidPage, Op } from './layout';
import { hex } from './theme';

const PT = 0.3528;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const family = (font: Font) => (font.family === 'courier' ? "'Courier New', Courier, monospace" : "Helvetica, Arial, 'Liberation Sans', sans-serif");

function draw(op: Op): string {
  if (op.t === 'rect') {
    const fill = op.fill ? hex(op.fill) : 'none';
    const stroke = op.stroke ? ` stroke="${hex(op.stroke)}" stroke-width="${op.lineWidth ?? 0.2}"` : '';
    return `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}"${op.radius ? ` rx="${op.radius}"` : ''} fill="${fill}"${stroke}/>`;
  }
  if (op.t === 'line') return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${hex(op.color)}" stroke-width="${op.width}"/>`;
  if (op.t === 'circle') return `<circle cx="${op.x}" cy="${op.y}" r="${op.r}" fill="${hex(op.fill)}"/>`;
  return `<text x="${op.x}" y="${op.y}" font-family="${family(op.font)}" font-size="${(op.size * PT).toFixed(3)}" font-weight="${op.font.bold ? 700 : 400}"${op.font.italic ? ' font-style="italic"' : ''}${op.underline ? ' text-decoration="underline"' : ''} fill="${hex(op.color)}" xml:space="preserve">${escape(op.text)}</text>`;
}

export function pageSvg(layout: Layout, page: LaidPage): string {
  const { width, height } = layout.theme.page;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${page.ops.map(draw).join('')}</svg>`;
}

export const layoutSvgs = (layout: Layout) => layout.pages.map(page => pageSvg(layout, page));
