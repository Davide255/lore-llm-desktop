// Design tokens — Athly design system (tokens/colors.css, spacing.css,
// typography.css) plus the KB Desktop screen-level palette (--ink, --cell…).
import type { TextStyle, ViewStyle } from 'react-native';

export const c = {
  // brand
  purple: '#8f5cff',
  purpleShade: '#7a46f0',
  purpleTint: '#a37aff',
  blue: '#3a86ff',
  blueTint: '#7aa9ff',
  gradient: 'linear-gradient(90deg, #8f5cff 0%, #3a86ff 100%)',
  bgGradient:
    'radial-gradient(60% 60% at 85% 0%, rgba(143,92,255,0.18) 0%, transparent 60%), radial-gradient(55% 55% at 5% 100%, rgba(58,134,255,0.14) 0%, transparent 55%)',

  // ink
  ink: '#faf9f5',
  ink78: 'rgba(250,249,245,.78)',
  ink2: 'rgba(250,249,245,.60)',
  ink3: 'rgba(250,249,245,.38)',
  ink4: 'rgba(250,249,245,.22)',
  hair: 'rgba(250,249,245,.10)',
  hairSoft: 'rgba(250,249,245,.06)',

  // surfaces
  window: '#121211',
  titlebar: '#141316',
  sidebar: '#161518',
  cell: '#1c1b20',
  cell2: '#232129',
  surface4: '#2a2537',
  dialog: '#232228',
  menu: 'rgba(40,39,45,.98)',
  toast: 'rgba(58,57,64,.98)',
  fill04: 'rgba(250,249,245,.04)',
  fill05: 'rgba(250,249,245,.05)',
  fill06: 'rgba(250,249,245,.06)',
  fill07: 'rgba(250,249,245,.07)',
  fill08: 'rgba(250,249,245,.08)',
  fill09: 'rgba(250,249,245,.09)',
  fill12: 'rgba(250,249,245,.12)',

  // purple washes
  purple10: 'rgba(143,92,255,.10)',
  purple12: 'rgba(143,92,255,.12)',
  purple14: 'rgba(143,92,255,.14)',
  purple16: 'rgba(143,92,255,.16)',
  purple18: 'rgba(143,92,255,.18)',
  purple20: 'rgba(143,92,255,.20)',
  purple28: 'rgba(143,92,255,.28)',
  purple40: 'rgba(143,92,255,.40)',
  blue18: 'rgba(58,134,255,.18)',

  // status
  info: '#5ac8fa',
  info10: 'rgba(90,200,250,.10)',
  info16: 'rgba(90,200,250,.16)',
  success: '#5cc87c',
  success13: 'rgba(92,200,124,.13)',
  success16: 'rgba(92,200,124,.16)',
  successText: '#9be0ae',
  warning: '#f5a623',
  warning14: 'rgba(245,166,35,.14)',
  danger: '#ff3b30',
  danger14: 'rgba(255,59,48,.14)',
  error: '#ff6b6b',
  error13: 'rgba(255,107,107,.13)',
  error14: 'rgba(255,107,107,.14)',
  errorText: '#ff9b9b',
} as const;

export const font = {
  sf: '-apple-system, "SF Pro Text", "SF Pro Display", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Consolas, Menlo, monospace',
  icon: '"Material Symbols Rounded"',
};

export const radius = { sm: 8, md: 10, lg: 12, card: 14, xl: 20, pill: 9999 };

export const shadow = {
  window: '0 30px 80px rgba(0,0,0,.6)',
  pop: '0 20px 60px rgba(0,0,0,0.50)',
  menu: '0 18px 48px rgba(0,0,0,.6)',
  toast: '0 14px 36px rgba(0,0,0,.55)',
  primary: '0 4px 14px rgba(143,92,255,.3)',
  seg: '0 1px 3px rgba(0,0,0,.4)',
  focus: '0 0 0 3px rgba(143,92,255,.2)',
};

/** Web-only CSS (cursor, boxShadow strings, gradients…) typed as RN style. */
export const web = <T extends ViewStyle | TextStyle = ViewStyle>(s: Record<string, unknown>) => s as unknown as T;

/** Text preset — mirrors the design's `font: <weight> <size>/<lh> var(--sf)`. */
export function t(
  weight: 400 | 500 | 600 | 700,
  size: number,
  lineHeight?: number,
  extra: TextStyle = {},
): TextStyle {
  return {
    fontFamily: font.sf,
    fontWeight: String(weight) as TextStyle['fontWeight'],
    fontSize: size,
    lineHeight: lineHeight ? Math.round(size * lineHeight * 100) / 100 : undefined,
    color: c.ink,
    ...extra,
  };
}

export const mono = (size = 13, extra: TextStyle = {}): TextStyle => ({ fontFamily: font.mono, fontSize: size, color: c.ink, ...extra });
