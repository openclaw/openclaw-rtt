import fs from "node:fs/promises";
import path from "node:path";

const [summaryPath, scenarioId, title, details, startedAt, finishedAt] =
  process.argv.slice(2);

if (!summaryPath || !scenarioId || !title || !details || !startedAt || !finishedAt) {
  throw new Error(
    "Usage: node scripts/write-failed-channel-summary.mjs <summary-path> <scenario-id> <title> <details> <started-at> <finished-at>",
  );
}

await fs.mkdir(path.dirname(summaryPath), { recursive: true });
await fs.writeFile(
  summaryPath,
  `${JSON.stringify(
    {
      startedAt,
      finishedAt,
      counts: {
        total: 1,
        passed: 0,
        failed: 1,
      },
      scenarios: [
        {
          id: scenarioId,
          title,
          status: "fail",
          details,
        },
      ],
    },
    null,
    2,
  )}\n`,
);
