export const palette = {
  eggshell: "#F3EFDE",
  "midnight-violet": "#271F30",
  "deep-teal": "#4E6E58",
} as const;

export type PaletteToken = keyof typeof palette;

export const cssVariables = Object.entries(palette)
  .map(([token, value]) => `--${token}: ${value};`)
  .join("\n  ");
