export interface BrickColor {
  name: string;
  hex: string;
  rgb: [number, number, number];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
}

const colors: Array<[string, string]> = [
  ["White", "#f4f4f4"],
  ["Light Bluish Gray", "#a0a5a9"],
  ["Dark Bluish Gray", "#6c6e68"],
  ["Black", "#1b1b1b"],
  ["Red", "#b40000"],
  ["Dark Red", "#7a160f"],
  ["Bright Orange", "#d67923"],
  ["Yellow", "#f2cd37"],
  ["Tan", "#dec69c"],
  ["Dark Tan", "#958a73"],
  ["Reddish Brown", "#5f3109"],
  ["Nougat", "#d09168"],
  ["Medium Nougat", "#aa7d55"],
  ["Bright Green", "#4b9f4a"],
  ["Green", "#237841"],
  ["Dark Green", "#184632"],
  ["Lime", "#bbd649"],
  ["Olive Green", "#9b9a5a"],
  ["Blue", "#0055bf"],
  ["Dark Blue", "#0a3463"],
  ["Medium Blue", "#5a93db"],
  ["Dark Azure", "#078bc9"],
  ["Bright Light Blue", "#9fc3e9"],
  ["Sand Blue", "#6074a1"],
  ["Purple", "#81007b"],
  ["Medium Lavender", "#ac78ba"],
  ["Magenta", "#923978"],
  ["Bright Pink", "#e4adc8"],
  ["Trans Neon Green", "#c0ff00"],
  ["Sand Green", "#a0bcac"],
  ["Dark Pink", "#c870a0"],
  ["Medium Stone Gray", "#969696"]
];

export const BRICK_PALETTE: BrickColor[] = colors.map(([name, hex]) => ({
  name,
  hex,
  rgb: hexToRgb(hex)
}));

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function nearestBrickColor(r: number, g: number, b: number): BrickColor {
  let nearest = BRICK_PALETTE[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  const lr = channelToLinear(r);
  const lg = channelToLinear(g);
  const lb = channelToLinear(b);

  for (const color of BRICK_PALETTE) {
    const [cr, cg, cb] = color.rgb;
    const dr = lr - channelToLinear(cr);
    const dg = lg - channelToLinear(cg);
    const db = lb - channelToLinear(cb);
    const distance = dr * dr * 0.35 + dg * dg * 0.45 + db * db * 0.2;
    if (distance < nearestDistance) {
      nearest = color;
      nearestDistance = distance;
    }
  }

  return nearest;
}
