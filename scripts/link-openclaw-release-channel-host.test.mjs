import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { linkOpenClawReleaseChannelHost } from "./link-openclaw-release-channel-host.mjs";

async function makeFixture({ exportedPath = "./dist/plugin-sdk/channel-outbound.js" } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-release-channel-host-"));
  const channelDir = path.join(root, "extensions", "slack");
  const exportPath = path.join(root, "dist", "plugin-sdk", "channel-outbound.js");
  await Promise.all([
    fs.mkdir(channelDir, { recursive: true }),
    fs.mkdir(path.dirname(exportPath), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({
        name: "openclaw",
        type: "module",
        exports: {
          "./plugin-sdk/channel-outbound": exportedPath,
        },
      })}\n`,
    ),
    fs.writeFile(path.join(channelDir, "package.json"), '{"name":"@openclaw/slack"}\n'),
    fs.writeFile(path.join(channelDir, "streaming-compat.ts"), "export const unchanged = true;\n"),
    fs.writeFile(exportPath, "export const outbound = true;\n"),
  ]);
  return { channelDir, exportPath, root };
}

test("links the selected release channel to the exact release host", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));

  const sourceBefore = await fs.readFile(
    path.join(fixture.channelDir, "streaming-compat.ts"),
    "utf8",
  );
  const result = await linkOpenClawReleaseChannelHost(fixture.root, "slack");

  assert.equal(result.created, true);
  assert.equal(await fs.realpath(result.hostLink), await fs.realpath(fixture.root));
  assert.equal(
    await fs.readFile(path.join(fixture.channelDir, "streaming-compat.ts"), "utf8"),
    sourceBefore,
  );
});

test("is idempotent when the exact release host is already linked", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));

  const first = await linkOpenClawReleaseChannelHost(fixture.root, "slack");
  const second = await linkOpenClawReleaseChannelHost(fixture.root, "slack");

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.hostLink, first.hostLink);
});

test("refuses a non-symlink host path", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));
  const hostLink = path.join(fixture.channelDir, "node_modules", "openclaw");
  await fs.mkdir(hostLink, { recursive: true });

  await assert.rejects(
    linkOpenClawReleaseChannelHost(fixture.root, "slack"),
    /Refusing to replace non-symlink host path/u,
  );
});

test("refuses a symlink to a different host", async (t) => {
  const fixture = await makeFixture();
  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-other-host-"));
  t.after(() => Promise.all([
    fs.rm(fixture.root, { force: true, recursive: true }),
    fs.rm(otherRoot, { force: true, recursive: true }),
  ]));
  const hostLink = path.join(fixture.channelDir, "node_modules", "openclaw");
  await fs.mkdir(path.dirname(hostLink), { recursive: true });
  await fs.symlink(otherRoot, hostLink, "dir");

  await assert.rejects(
    linkOpenClawReleaseChannelHost(fixture.root, "slack"),
    /Refusing conflicting OpenClaw host link/u,
  );
});

test("refuses a broken host symlink", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));
  const hostLink = path.join(fixture.channelDir, "node_modules", "openclaw");
  await fs.mkdir(path.dirname(hostLink), { recursive: true });
  await fs.symlink(path.join(fixture.root, "missing-host"), hostLink, "dir");

  await assert.rejects(
    linkOpenClawReleaseChannelHost(fixture.root, "slack"),
    /Refusing broken OpenClaw host link/u,
  );
});

test("rolls back a new link when the host export resolves elsewhere", async (t) => {
  const fixture = await makeFixture({ exportedPath: "./dist/plugin-sdk/other.js" });
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));
  await fs.writeFile(
    path.join(fixture.root, "dist", "plugin-sdk", "other.js"),
    "export const other = true;\n",
  );
  const hostLink = path.join(fixture.channelDir, "node_modules", "openclaw");

  await assert.rejects(
    linkOpenClawReleaseChannelHost(fixture.root, "slack"),
    /resolved to .*other\.js, expected .*channel-outbound\.js/u,
  );
  await assert.rejects(fs.lstat(hostLink), { code: "ENOENT" });
});

test("rejects channel paths outside the selected extension", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { force: true, recursive: true }));

  await assert.rejects(
    linkOpenClawReleaseChannelHost(fixture.root, "../slack"),
    /Usage:/u,
  );
});
