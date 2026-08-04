import {
  getContrastRatio,
  normalizeHexColor,
  type ResolvedThemeMode,
} from './theme';

export const APP_ICON_PATH = 'M352 224H768V800H256V544H384V672H640V352H352Z';
export const FAVICON_LINK_ID = 'app-favicon';
export const FAVICON_MIN_CONTRAST = 4.5;

type HslColor = { hue: number; saturation: number; lightness: number };

function hexToHsl(hexColor: string): HslColor {
  const color = normalizeHexColor(hexColor) ?? '#00DD99';
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }

  return { hue: hue < 0 ? hue + 360 : hue, saturation, lightness };
}

function hslToHex({ hue, saturation, lightness }: HslColor): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  const offset = lightness - chroma / 2;

  let channels: [number, number, number];
  if (section < 1) channels = [chroma, intermediate, 0];
  else if (section < 2) channels = [intermediate, chroma, 0];
  else if (section < 3) channels = [0, chroma, intermediate];
  else if (section < 4) channels = [0, intermediate, chroma];
  else if (section < 5) channels = [intermediate, 0, chroma];
  else channels = [chroma, 0, intermediate];

  return `#${channels.map((channel) => Math.round((channel + offset) * 255)
    .toString(16)
    .padStart(2, '0')).join('').toUpperCase()}`;
}

export function ensureFaviconContrast(
  accentColor: string,
  backgroundColor: string,
  minimumContrast = FAVICON_MIN_CONTRAST,
): string {
  const accent = normalizeHexColor(accentColor) ?? '#00DD99';
  const background = normalizeHexColor(backgroundColor) ?? '#FFFFFF';
  if (getContrastRatio(accent, background) >= minimumContrast) return accent;

  const hsl = hexToHsl(accent);
  const lighten = background === '#000000';
  for (let step = 1; step <= 1000; step += 1) {
    const progress = step / 1000;
    const lightness = lighten
      ? hsl.lightness + (1 - hsl.lightness) * progress
      : hsl.lightness * (1 - progress);
    const candidate = hslToHex({ ...hsl, lightness });
    if (getContrastRatio(candidate, background) >= minimumContrast) return candidate;
  }

  return lighten ? '#FFFFFF' : '#000000';
}

export function getFaviconPalette(accentColor: string, mode: ResolvedThemeMode) {
  const backgroundColor = mode === 'dark' ? '#000000' : '#FFFFFF';
  return {
    backgroundColor,
    markColor: ensureFaviconContrast(accentColor, backgroundColor),
  };
}

export function createFaviconSvg(accentColor: string, mode: ResolvedThemeMode): string {
  const { backgroundColor, markColor } = getFaviconPalette(accentColor, mode);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${backgroundColor}"/><path fill="${markColor}" d="${APP_ICON_PATH}"/></svg>`;
}

export function createFaviconDataUrl(accentColor: string, mode: ResolvedThemeMode): string {
  return `data:image/svg+xml,${encodeURIComponent(createFaviconSvg(accentColor, mode))}`;
}

export function updateFavicon(documentNode: Document, accentColor: string, mode: ResolvedThemeMode) {
  documentNode.getElementById(FAVICON_LINK_ID)?.setAttribute('href', createFaviconDataUrl(accentColor, mode));
}
