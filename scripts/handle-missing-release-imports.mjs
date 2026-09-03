function main() {
  const [family, measureResult, ...extraArgs] = process.argv.slice(2);

  if (!family || !measureResult || extraArgs.length > 0) {
    throw new Error(
      "Usage: node scripts/handle-missing-release-imports.mjs <family> <measure-result>",
    );
  }

  if (measureResult === "success") {
    throw new Error(`No ${family} release RTT import artifacts arrived after a successful matrix.`);
  }
  if (measureResult !== "failure" && measureResult !== "cancelled") {
    throw new Error(`Unexpected ${family} release RTT measure result: ${measureResult}`);
  }

  process.stdout.write(
    `::notice title=${family} release RTT import skipped::No import artifacts arrived; measure matrix result was ${measureResult}.\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
