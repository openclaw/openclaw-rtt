import { compareStartedAt, readChannelRows } from "./channel-storage.mjs";

export { compareStartedAt };

export async function readRows() {
  return await readChannelRows("telegram");
}
