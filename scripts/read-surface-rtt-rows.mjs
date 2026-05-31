import { compareStartedAt, readAllSurfaceRows } from "./surface-storage.mjs";

export function compareSurfaceRttStartedAt(left, right) {
  return compareStartedAt(left, right);
}

export async function readSurfaceRttRows() {
  return await readAllSurfaceRows();
}
