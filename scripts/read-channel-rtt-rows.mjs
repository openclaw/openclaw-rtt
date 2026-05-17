import { compareStartedAt, readAllChannelRows } from "./channel-storage.mjs";

export function compareChannelRttStartedAt(left, right) {
  return compareStartedAt(left, right);
}

export async function readChannelRttRows() {
  return (await readAllChannelRows()).filter(
    (row) =>
      typeof row.channel?.id === "string" &&
      row.channel.id !== "telegram" &&
      row.channel.id !== "discord",
  );
}
