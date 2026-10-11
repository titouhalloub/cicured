const RESET = "[0m";

const CODES = {
  green: "[32m",
  red: "[31m",
  yellow: "[33m",
  dim: "[2m",
  bold: "[1m",
};

export const useColor = (): boolean =>
  process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);

function paint(code: string, s: string): string {
  return useColor() ? `${code}${s}${RESET}` : s;
}

export function pass(s: string): string {
  return paint(CODES.green, s);
}

export function fail(s: string): string {
  return paint(CODES.red, s);
}

export function warn(s: string): string {
  return paint(CODES.yellow, s);
}

export function dim(s: string): string {
  return paint(CODES.dim, s);
}

export function bold(s: string): string {
  return paint(CODES.bold, s);
}

export function banner(text: string): string {
  return dim(`── ${text} ──`);
}

export function hr(): string {
  return dim("—".repeat(40));
}
