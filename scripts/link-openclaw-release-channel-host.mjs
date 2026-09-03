import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOST_EXPORT = "openclaw/plugin-sdk/channel-outbound";

function usage() {
  return "Usage: node scripts/link-openclaw-release-channel-host.mjs <openclaw-repo-root> <channel>";
}

async function existingLinkTarget(linkPath) {
  let stat;
  try {
    stat = await fs.lstat(linkPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to replace non-symlink host path: ${linkPath}`);
  }
  try {
    return await fs.realpath(linkPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Refusing broken OpenClaw host link: ${linkPath}`);
    }
    throw error;
  }
}

export async function linkOpenClawReleaseChannelHost(repoRootInput, channel) {
  if (!repoRootInput || !/^[a-z0-9][a-z0-9-]*$/u.test(channel ?? "")) {
    throw new Error(usage());
  }

  const repoRoot = await fs.realpath(path.resolve(repoRootInput));
  const channelDir = path.join(repoRoot, "extensions", channel);
  const channelPackageJson = path.join(channelDir, "package.json");
  const expectedExport = path.join(repoRoot, "dist", "plugin-sdk", "channel-outbound.js");

  await Promise.all([fs.access(channelPackageJson), fs.access(expectedExport)]);

  const hostLink = path.join(channelDir, "node_modules", "openclaw");
  const currentTarget = await existingLinkTarget(hostLink);
  if (currentTarget && currentTarget !== repoRoot) {
    throw new Error(`Refusing conflicting OpenClaw host link: ${hostLink} -> ${currentTarget}`);
  }

  const created = currentTarget === undefined;
  if (created) {
    await fs.mkdir(path.dirname(hostLink), { recursive: true });
    await fs.symlink(repoRoot, hostLink, "dir");
  }

  try {
    const requireFromChannel = createRequire(channelPackageJson);
    const resolvedExport = await fs.realpath(requireFromChannel.resolve(HOST_EXPORT));
    const expectedRealpath = await fs.realpath(expectedExport);
    if (resolvedExport !== expectedRealpath) {
      throw new Error(
        `${HOST_EXPORT} resolved to ${resolvedExport}, expected ${expectedRealpath}`,
      );
    }
  } catch (error) {
    if (created) {
      await fs.rm(hostLink, { force: true });
    }
    throw error;
  }

  return { channelDir, created, hostLink, repoRoot };
}

async function main() {
  const [repoRoot, channel, ...extra] = process.argv.slice(2);
  if (extra.length > 0) {
    throw new Error(usage());
  }
  const result = await linkOpenClawReleaseChannelHost(repoRoot, channel);
  console.log(
    `${result.created ? "linked" : "verified"} ${result.hostLink} -> ${result.repoRoot}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
