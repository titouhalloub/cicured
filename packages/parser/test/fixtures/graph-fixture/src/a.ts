import { functionB } from "./b";

export function functionA(n: number): number {
  return functionB(n) + 1;
}
