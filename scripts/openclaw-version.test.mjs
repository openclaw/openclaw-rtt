import assert from "node:assert/strict";
import test from "node:test";

import {
  compareOpenClawVersions,
  isOpenClawReleaseSpec,
  isStableOpenClawVersion,
  parseOpenClawVersion,
} from "./openclaw-version.mjs";

test("parses beta, stable, and numeric post-release versions", () => {
  assert.deepEqual(parseOpenClawVersion("2026.7.1-beta.4"), {
    version: "2026.7.1-beta.4",
    major: 2026,
    minor: 7,
    patch: 1,
    kind: "beta",
    releaseNumber: 4,
  });
  assert.equal(parseOpenClawVersion("2026.7.1")?.kind, "stable");
  assert.deepEqual(parseOpenClawVersion("2026.7.1-2"), {
    version: "2026.7.1-2",
    major: 2026,
    minor: 7,
    patch: 1,
    kind: "post",
    releaseNumber: 2,
  });
});

test("orders beta before stable and numeric post releases", () => {
  const versions = ["2026.7.1-2", "2026.7.1", "2026.7.1-beta.4", "2026.7.1-1"];
  assert.deepEqual(versions.sort(compareOpenClawVersions), [
    "2026.7.1-beta.4",
    "2026.7.1",
    "2026.7.1-1",
    "2026.7.1-2",
  ]);
});

test("treats stable and numeric post releases as stable", () => {
  assert.equal(isStableOpenClawVersion("2026.7.1-beta.4"), false);
  assert.equal(isStableOpenClawVersion("2026.7.1"), true);
  assert.equal(isStableOpenClawVersion("2026.7.1-1"), true);
});

test("accepts only exact OpenClaw release specs", () => {
  assert.equal(isOpenClawReleaseSpec("openclaw@2026.7.1-beta.4"), true);
  assert.equal(isOpenClawReleaseSpec("openclaw@2026.7.1"), true);
  assert.equal(isOpenClawReleaseSpec("openclaw@2026.7.1-2"), true);
  assert.equal(isOpenClawReleaseSpec("openclaw@main"), false);
  assert.equal(isOpenClawReleaseSpec("other@2026.7.1-2"), false);
});

test("rejects unsupported or non-canonical versions", () => {
  for (const version of [
    "2026.7.1-alpha.1",
    "2026.7.1-beta.0",
    "2026.7.1-beta.01",
    "2026.7.1-0",
    "2026.7.1-01",
    "2026.7.1-rc.1",
    "2026.07.1",
    "2026.7.01",
  ]) {
    assert.equal(parseOpenClawVersion(version), undefined);
  }
  assert.throws(
    () => compareOpenClawVersions("2026.7.1", "2026.7.1-rc.1"),
    /Cannot compare unsupported versions/u,
  );
});
