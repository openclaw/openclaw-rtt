import fs from "node:fs/promises";
import path from "node:path";
import { compareStartedAt, readJsonl, writeJsonl, appendJsonl } from "./channel-storage.mjs";

export const SURFACE_DATA_DIR = "data/surfaces";
export const SURFACE_RUNS_DIR = "runs/surfaces";
export { compareStartedAt };

export function surfaceDataDir(surfaceId) {
  return path.join(SURFACE_DATA_DIR, surfaceId);
}

export function surfaceVersionKey(version) {
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error("surface data version key must be a non-empty string.");
  }
  return version.replace(/[^a-zA-Z0-9.+_-]+/gu, "_").replace(/^_+|_+$/gu, "");
}

export function surfaceDataPath(surfaceId, version) {
  return path.join(surfaceDataDir(surfaceId), `${surfaceVersionKey(version)}.jsonl`);
}

export function surfaceRunsDir(surfaceId) {
  return path.join(SURFACE_RUNS_DIR, surfaceId);
}

export function surfaceResultPath(surfaceId, runId) {
  return path.join(surfaceRunsDir(surfaceId), runId, "result.json");
}

export async function appendSurfaceRow(surfaceId, row) {
  await appendJsonl(surfaceDataPath(surfaceId, row.package?.version), row);
}

export async function writeSurfaceRows(surfaceId, version, rows) {
  await writeJsonl(surfaceDataPath(surfaceId, version), rows);
}

async function readSurfaceFiles(surfaceId) {
  let entries = [];
  try {
    entries = await fs.readdir(surfaceDataDir(surfaceId), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(surfaceDataDir(surfaceId), entry.name))
    .sort();
}

export async function readSurfaceRows(surfaceId) {
  const rows = [];
  for (const file of await readSurfaceFiles(surfaceId)) {
    rows.push(...(await readJsonl(file)));
  }
  return rows.sort(compareStartedAt);
}

export async function readAllSurfaceRows() {
  let entries = [];
  try {
    entries = await fs.readdir(SURFACE_DATA_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const rows = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      rows.push(...(await readSurfaceRows(entry.name)));
    }
  }
  return rows.sort(compareStartedAt);
}

export async function existingSurfaceRunIds(surfaceId) {
  return new Set((await readSurfaceRows(surfaceId)).map((row) => row.run?.id).filter(Boolean));
}
