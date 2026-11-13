/**
 * Mermaid colours taken from the OpenChamber theme.
 *
 * Mermaid's stock themes are a fixed lavender (light) and a fixed grey (dark). With its `base`
 * theme and a handful of colours, diagrams follow whatever theme the app is using. Mermaid
 * derives the rest (second and third colours for charts, and so on) from these.
 */
import { mix, solid, toHex, type Rgb } from './color';

export interface ThemeTokens {
  readonly [name: string]: string | undefined;
}

export interface MermaidTheme {
  readonly theme: 'base';
  readonly themeVariables: Readonly<Record<string, string | boolean>>;
  readonly key: string;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

export function mermaidThemeFor(mode: 'light' | 'dark', tokens: ThemeTokens): MermaidTheme {
  const dark = mode === 'dark';
  const background = solid(tokens.background, dark ? BLACK : WHITE, dark ? [14, 12, 11] : [250, 249, 247]);
  const on = (value: string | undefined, fallback: Rgb): Rgb => solid(value, background, fallback);

  const foreground = on(tokens.foreground, dark ? [219, 215, 204] : [68, 68, 61]);
  const muted = on(tokens.muted, mix(background, foreground, 0.6));
  const elevated = on(tokens.elevated, mix(background, foreground, 0.05));
  const primary = on(tokens.primary, dark ? [218, 124, 71] : [179, 80, 23]);
  const warning = on(tokens.warning, [198, 127, 19]);

  // A node is the page background with a little of the accent in it, and a border that is
  // the same idea, stronger. Diagrams sit on the code-block surface (`elevated`).
  const node = mix(background, primary, dark ? 0.2 : 0.1);
  const nodeBorder = mix(background, primary, dark ? 0.62 : 0.5);
  const line = mix(background, foreground, dark ? 0.55 : 0.6);

  const chart = [tokens.primary, tokens.info, tokens.success, tokens.warning, tokens.error, tokens.syntaxType, tokens.syntaxKeyword, tokens.syntaxString]
    .map((value) => on(value, primary))
    .map((colour) => toHex(mix(colour, background, dark ? 0.15 : 0.1)));

  const themeVariables: Record<string, string | boolean> = {
    darkMode: dark,
    background: toHex(elevated),
    primaryColor: toHex(node),
    primaryTextColor: toHex(foreground),
    primaryBorderColor: toHex(nodeBorder),
    lineColor: toHex(line),
    textColor: toHex(foreground),
    titleColor: toHex(foreground),
    edgeLabelBackground: toHex(elevated),
    clusterBkg: toHex(mix(elevated, foreground, 0.04)),
    clusterBorder: toHex(mix(background, foreground, 0.22)),
    noteBkgColor: toHex(mix(background, warning, dark ? 0.22 : 0.16)),
    noteTextColor: toHex(foreground),
    noteBorderColor: toHex(mix(background, warning, 0.55)),
    activationBkgColor: toHex(mix(background, primary, dark ? 0.32 : 0.2)),
    activationBorderColor: toHex(nodeBorder),
    signalColor: toHex(line),
    signalTextColor: toHex(foreground),
    labelBoxBkgColor: toHex(node),
    labelBoxBorderColor: toHex(nodeBorder),
    labelTextColor: toHex(foreground),
    loopTextColor: toHex(foreground),
    actorLineColor: toHex(mix(background, muted, 0.7)),
    pieStrokeColor: toHex(elevated),
    pieOuterStrokeColor: toHex(mix(background, foreground, 0.22)),
    pieTitleTextColor: toHex(foreground),
    pieSectionTextColor: toHex(dark ? foreground : WHITE),
    pieLegendTextColor: toHex(foreground),
  };
  chart.forEach((colour, index) => {
    themeVariables[`pie${index + 1}`] = colour;
  });

  return {
    theme: 'base',
    themeVariables,
    key: [mode, tokens.background, tokens.foreground, tokens.primary, tokens.elevated].join('|'),
  };
}
