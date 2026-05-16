import fs from "node:fs/promises";
import path from "node:path";
import { aggregateResources, readResourceMetrics } from "./resource-metrics.mjs";

const FAMILIES = {
  telegram: {
    dataPath: path.resolve("data/rtt.jsonl"),
    runsDir: path.resolve("runs"),
  },
  discord: {
    dataPath: path.resolve("data/discord-rtt.jsonl"),
    runsDir: path.resolve("discord-runs"),
  },
};

function usage() {
  return [
    "Usage: node scripts/backfill-release-rss.mjs --family <telegram|discord>",
    "  (--result <result.json> | --spec <openclaw@version> --version <version>)",
    "  (--resource-metrics <resource-metrics.env> | --sample-paths <sample-paths.tsv>)",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--family") {
      args.family = argv[(index += 1)];
      continue;
    }
    if (arg === "--result") {
      args.resultPath = argv[(index += 1)];
      continue;
    }
    if (arg === "--spec") {
      args.spec = argv[(index += 1)];
      continue;
    }
    if (arg === "--version") {
      args.version = argv[(index += 1)];
      continue;
    }
    if (arg === "--resource-metrics") {
      args.resourceMetricsPath = argv[(index += 1)];
      continue;
    }
    if (arg === "--sample-paths") {
      args.samplePaths = argv[(index += 1)];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!FAMILIES[args.family]) {
    throw new Error(usage());
  }
  if (!args.resultPath && (!args.spec || !args.version)) {
    throw new Error(usage());
  }
  if (!args.resourceMetricsPath && !args.samplePaths) {
    throw new Error(usage());
  }
  if (args.resourceMetricsPath && args.samplePaths) {
    throw new Error("Use either --resource-metrics or --sample-paths, not both.");
  }
  return args;
}

async function readJson(pathname) {
  return JSON.parse(await fs.readFile(pathname, "utf8"));
}

async function readJsonl(pathname) {
  const text = await fs.readFile(pathname, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeJsonl(pathname, rows) {
  await fs.writeFile(pathname, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function readResources(args) {
  if (args.resourceMetricsPath) {
    return aggregateResources([await readResourceMetrics(path.resolve(args.resourceMetricsPath))]);
  }

  const text = await fs.readFile(path.resolve(args.samplePaths), "utf8");
  const samples = [];
  for (const [index, line] of text.split("\n").filter(Boolean).entries()) {
    const resourceMetricsPath = line.split("\t")[2];
    if (!resourceMetricsPath) {
      throw new Error(`sample-paths line ${index + 1} is missing a resource metrics path.`);
    }
    samples.push(await readResourceMetrics(path.resolve(resourceMetricsPath)));
  }
  return aggregateResources(samples);
}

function rttFingerprint(rows) {
  return new Map(
    rows.map((row) => [
      row.run.id,
      JSON.stringify({
        p50Ms: row.rtt?.p50Ms,
        p95Ms: row.rtt?.p95Ms,
      }),
    ]),
  );
}

function assertRttUnchanged(before, afterRows) {
  for (const row of afterRows) {
    const previous = before.get(row.run.id);
    if (previous === undefined) {
      continue;
    }
    const current = JSON.stringify({
      p50Ms: row.rtt?.p50Ms,
      p95Ms: row.rtt?.p95Ms,
    });
    if (current !== previous) {
      throw new Error(`RTT p50/p95 changed for ${row.run.id}: ${previous} -> ${current}`);
    }
  }
}

function latestMatch(matches) {
  return matches.sort((left, right) =>
    String(left.row.run?.startedAt).localeCompare(String(right.row.run?.startedAt)),
  ).at(-1);
}

async function resolveTarget(args) {
  if (!args.resultPath) {
    return { spec: args.spec, version: args.version };
  }
  const result = await readJson(path.resolve(args.resultPath));
  return {
    spec: result.package?.spec,
    version: result.package?.version,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const family = FAMILIES[args.family];
  const target = await resolveTarget(args);
  if (typeof target.spec !== "string" || typeof target.version !== "string") {
    throw new Error("Backfill target must resolve package.spec and package.version.");
  }

  const resources = await readResources(args);
  if (!resources?.maxRssKb?.max) {
    throw new Error("Backfill resource metrics did not include max_rss_kb.");
  }

  const rows = await readJsonl(family.dataPath);
  const before = rttFingerprint(rows);
  const matches = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) => row.package?.spec === target.spec && row.package?.version === target.version,
    );
  if (matches.length === 0) {
    throw new Error(
      `Expected at least one ${args.family} row for ${target.spec} ${target.version}, found 0.`,
    );
  }

  const { row, index } = latestMatch(matches);
  rows[index] = {
    ...row,
    resources,
  };
  assertRttUnchanged(before, rows);
  await writeJsonl(family.dataPath, rows);

  const resultPath = path.join(family.runsDir, row.run.id, "result.json");
  const result = await readJson(resultPath);
  result.resources = resources;
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

  process.stdout.write(
    `backfilled ${args.family} RSS for ${target.spec} ${target.version}; p50/p95 unchanged\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
