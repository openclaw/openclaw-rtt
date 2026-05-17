import fs from "node:fs/promises";

export function quantile(sorted, q) {
  if (sorted.length === 0) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index];
}

export function numericStats(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    avg: sorted.length ? total / sorted.length : undefined,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted.at(-1),
  };
}

function readFiniteNumber(value, label) {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return parsed;
}

export async function readResourceMetrics(pathname) {
  const text = await fs.readFile(pathname, "utf8");
  const values = Object.fromEntries(
    text
      .split("\n")
      .filter(Boolean)
      .filter((line) => line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

  return {
    maxRssKb: readFiniteNumber(values.max_rss_kb, "resource metrics max_rss_kb"),
    elapsedSeconds: readFiniteNumber(values.elapsed_seconds, "resource metrics elapsed_seconds"),
  };
}

export function aggregateResources(samples, measurement) {
  const maxRssKbSamples = samples.flatMap((sample) =>
    typeof sample.maxRssKb === "number" ? [sample.maxRssKb] : [],
  );
  const elapsedSecondsSamples = samples.flatMap((sample) =>
    typeof sample.elapsedSeconds === "number" ? [sample.elapsedSeconds] : [],
  );
  if (maxRssKbSamples.length === 0 && elapsedSecondsSamples.length === 0) {
    return undefined;
  }
  return {
    ...(measurement ? { measurement } : {}),
    maxRssKbSamples,
    elapsedSecondsSamples,
    maxRssKb: numericStats(maxRssKbSamples),
    elapsedSeconds: numericStats(elapsedSecondsSamples),
  };
}
