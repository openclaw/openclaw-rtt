import fs from "node:fs/promises";
import path from "node:path";

const callSites = [
  {
    label: "npm-telegram-package-install",
    broken:
      'run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \\',
    fixed: 'run_logged_print "npm-telegram-package-install" docker_e2e_docker_run_cmd run --rm \\',
  },
  {
    label: "npm-telegram-live-suite",
    broken:
      'run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \\',
    fixed: 'run_logged_print "npm-telegram-live-suite" docker_e2e_run_with_harness \\',
  },
];

function usage() {
  return "Usage: node scripts/patch-openclaw-telegram-harness.mjs <openclaw-repo-root>";
}

async function main() {
  const [repoRoot, ...extraArgs] = process.argv.slice(2);
  if (!repoRoot || extraArgs.length > 0) {
    throw new Error(usage());
  }

  const scriptPath = path.resolve(repoRoot, "scripts/e2e/npm-telegram-live-docker.sh");
  const original = await fs.readFile(scriptPath, "utf8");
  const lines = original.split("\n");
  const states = callSites.map((callSite) => {
    const matches = lines
      .map((line, index) => ({ index, line }))
      .filter(({ line }) => line.includes(`"${callSite.label}"`));
    if (matches.length !== 1) {
      return { kind: "unknown" };
    }
    const [match] = matches;
    if (match.line === callSite.broken) {
      return { index: match.index, kind: "broken" };
    }
    if (match.line === callSite.fixed) {
      return { index: match.index, kind: "fixed" };
    }
    return { kind: "unknown" };
  });
  const isBrokenContract = states.every((state) => state.kind === "broken");
  const isFixedContract = states.every((state) => state.kind === "fixed");
  if (!isBrokenContract && !isFixedContract) {
    throw new Error(`Unsupported Telegram harness logging contract in ${scriptPath}`);
  }

  if (isBrokenContract) {
    for (let index = 0; index < callSites.length; index += 1) {
      lines[states[index].index] = callSites[index].fixed;
    }
    await fs.writeFile(scriptPath, lines.join("\n"));
  }
  process.stdout.write(
    isBrokenContract
      ? `patched ${callSites.length} Telegram harness stdin consumers\n`
      : "Telegram harness stdin consumers already preserve input\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
