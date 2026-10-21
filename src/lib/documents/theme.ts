// The look of a document, apart from its content: page, margins, type scale, colors, and the tones of callouts. A document names a theme;
// it never carries a color. Every text/background pair used here is checked against the WCAG contrast ratio in the tests, so a theme
// cannot ship text that is hard to read. Units are millimetres and points.
import type { Tone } from './spec';

export type RGB = readonly [number, number, number];

export type Theme = {
  name: 'antonia' | 'cowork';
  page: { width: number; height: number; left: number; right: number; top: number; bottom: number };
  ink: RGB;
  muted: RGB;
  accent: RGB;
  accentDark: RGB;
  accentTint: RGB;
  rule: RGB;
  zebra: RGB;
  white: RGB;
  link: RGB;
  codeFill: RGB;
  tones: Record<Tone, { bar: RGB; fill: RGB; title: RGB }>;
  /** Type scale in points; leading is a multiple of the size. */
  type: { body: number; small: number; caption: number; h1: number; h2: number; h3: number; title: number; subtitle: number; figure: number; table: number; code: number; leading: number };
  /** Vertical rhythm in millimetres. */
  space: { paragraph: number; list: number; heading1: number; heading2: number; heading3: number; block: number };
};

const base = {
  page: { width: 210, height: 297, left: 20, right: 20, top: 24, bottom: 24 },
  white: [255, 255, 255] as RGB,
  type: { body: 10.5, small: 9, caption: 8, h1: 18, h2: 13.5, h3: 11, title: 30, subtitle: 13, figure: 20, table: 9, code: 8.5, leading: 1.45 },
  space: { paragraph: 3.2, list: 1.4, heading1: 9, heading2: 6.5, heading3: 5, block: 5 },
};

export const THEMES: Record<Theme['name'], Theme> = {
  antonia: {
    ...base, name: 'antonia',
    ink: [17, 24, 39], muted: [82, 91, 107], accent: [37, 99, 235], accentDark: [30, 58, 138], accentTint: [239, 244, 255],
    rule: [214, 220, 232], zebra: [247, 249, 252], link: [29, 78, 216], codeFill: [243, 244, 246],
    tones: {
      info: { bar: [37, 99, 235], fill: [239, 244, 255], title: [30, 58, 138] },
      warning: { bar: [202, 138, 4], fill: [254, 249, 232], title: [133, 77, 14] },
      success: { bar: [22, 128, 61], fill: [236, 249, 241], title: [21, 94, 52] },
      neutral: { bar: [107, 114, 128], fill: [243, 244, 246], title: [55, 65, 81] },
    },
  },
  // The warm look Cowork's documents have had: kept for its exports so they read as the same product.
  cowork: {
    ...base, name: 'cowork',
    ink: [31, 29, 26], muted: [98, 93, 84], accent: [164, 80, 31], accentDark: [120, 53, 15], accentTint: [253, 245, 238],
    rule: [226, 218, 208], zebra: [251, 248, 244], link: [146, 64, 14], codeFill: [244, 240, 235],
    tones: {
      info: { bar: [164, 80, 31], fill: [253, 245, 238], title: [120, 53, 15] },
      warning: { bar: [202, 138, 4], fill: [254, 249, 232], title: [133, 77, 14] },
      success: { bar: [22, 128, 61], fill: [236, 249, 241], title: [21, 94, 52] },
      neutral: { bar: [107, 114, 128], fill: [244, 242, 238], title: [55, 65, 81] },
    },
  },
};

export const themeOf = (name?: string): Theme => THEMES[name === 'cowork' ? 'cowork' : 'antonia'];

const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (color: RGB) => 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);

/** WCAG contrast ratio of two colors: 4.5 is the floor for body text. */
export function contrast(a: RGB, b: RGB): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export const hex = (color: RGB) => `#${color.map(value => value.toString(16).padStart(2, '0')).join('')}`;

/** Every pair of text color over background the layout can draw, for the contrast tests. */
export function themePairs(theme: Theme): Array<{ name: string; text: RGB; background: RGB }> {
  const pairs: Array<{ name: string; text: RGB; background: RGB }> = [
    { name: 'body', text: theme.ink, background: theme.white },
    { name: 'muted', text: theme.muted, background: theme.white },
    { name: 'muted on zebra', text: theme.muted, background: theme.zebra },
    { name: 'link', text: theme.link, background: theme.white },
    { name: 'accent', text: theme.accent, background: theme.white },
    { name: 'table header', text: theme.white, background: theme.accentDark },
    { name: 'figure', text: theme.accentDark, background: theme.accentTint },
    { name: 'figure label', text: theme.muted, background: theme.accentTint },
    { name: 'code', text: theme.ink, background: theme.codeFill },
    { name: 'ink on zebra', text: theme.ink, background: theme.zebra },
  ];
  for (const [tone, colors] of Object.entries(theme.tones)) {
    pairs.push({ name: `${tone} title`, text: colors.title, background: colors.fill }, { name: `${tone} text`, text: theme.ink, background: colors.fill });
  }
  return pairs;
}
