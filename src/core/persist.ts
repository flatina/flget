import type { PersistDef } from "./types";

export function normalizePersistEntries(input: unknown): PersistDef[] {
  if (!input) {
    return [];
  }
  const items = Array.isArray(input) ? input : [input];
  const result: PersistDef[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      result.push({ source: item, target: item });
      continue;
    }
    if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string") {
      result.push({ source: item[0], target: item[1] });
    }
  }
  return result;
}
