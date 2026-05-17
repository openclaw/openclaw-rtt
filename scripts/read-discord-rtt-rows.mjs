import { compareStartedAt, readChannelRows } from "./channel-storage.mjs";

export function compareDiscordRttStartedAt(left, right) {
  return compareStartedAt(left, right);
}

export async function readDiscordRttRows() {
  return await readChannelRows("discord");
}
