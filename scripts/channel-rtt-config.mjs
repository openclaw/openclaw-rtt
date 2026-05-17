import { channelDataPath, channelRunsDir } from "./channel-storage.mjs";

export const CHANNEL_RTT_CHANNELS = {
  discord: {
    command: "discord",
    defaultScenario: "discord-canary",
    label: "Discord",
  },
  slack: {
    command: "slack",
    defaultScenario: "slack-canary",
    label: "Slack",
    releaseSkipVersions: {
      "2026.4.24": "current QA harness writes a newer messages.groupChat.visibleReplies key",
      "2026.4.25": "current QA harness writes a newer messages.groupChat.visibleReplies key",
      "2026.4.26": "current QA harness writes a newer messages.groupChat.visibleReplies key",
      "2026.4.27": "current QA harness cannot speak the older gateway protocol",
      "2026.4.29": "current QA harness cannot speak the older gateway protocol",
      "2026.5.2": "current QA harness cannot speak the older gateway protocol",
      "2026.5.3": "current QA harness cannot speak the older gateway protocol",
      "2026.5.6": "current QA harness cannot speak the older gateway protocol",
    },
  },
  telegram: {
    command: "telegram",
    defaultScenario: "telegram-mentioned-message-reply",
    label: "Telegram",
  },
  whatsapp: {
    command: "whatsapp",
    defaultScenario: "whatsapp-canary",
    label: "WhatsApp",
    releaseSkipVersions: {
      "2026.4.24": "current QA harness cannot speak the older gateway protocol",
      "2026.4.25": "current QA harness cannot speak the older gateway protocol",
      "2026.4.26": "current QA harness cannot speak the older gateway protocol",
      "2026.4.27": "current QA harness cannot speak the older gateway protocol",
      "2026.4.29": "current QA harness cannot speak the older gateway protocol",
      "2026.5.2": "current QA harness cannot speak the older gateway protocol",
      "2026.5.3": "current QA harness cannot speak the older gateway protocol",
      "2026.5.4": "current QA harness cannot speak the older gateway protocol",
      "2026.5.6": "current QA harness cannot speak the older gateway protocol",
      "2026.5.7": "current QA harness cannot speak the older gateway protocol",
    },
  },
};

export function listChannelRttChannels() {
  return Object.entries(CHANNEL_RTT_CHANNELS).map(([id, channel]) => ({ id, ...channel }));
}

export function resolveChannelRttChannel(id) {
  const channel = CHANNEL_RTT_CHANNELS[id];
  if (!channel) {
    const known = Object.keys(CHANNEL_RTT_CHANNELS).sort().join(", ");
    throw new Error(`Unknown channel RTT channel: ${id}. Known channels: ${known}`);
  }
  return { id, ...channel };
}

export function channelRttDataPath(channelId, version) {
  return channelDataPath(channelId, version);
}

export function channelRttRunsDir(channelId) {
  return channelRunsDir(channelId);
}
