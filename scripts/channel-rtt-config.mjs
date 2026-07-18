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
      "2026.4.24": "release predates the Slack QA canary",
      "2026.4.25": "release predates the Slack QA canary",
      "2026.4.26": "release predates the Slack QA canary",
      "2026.4.27": "release predates the Slack QA canary",
      "2026.4.29": "release predates the Slack QA canary",
      "2026.5.2": "release predates the Slack QA canary",
    },
  },
  telegram: {
    command: "telegram",
    defaultScenario: "channel-canary",
    label: "Telegram",
    releaseSkipVersions: {
      "2026.7.1-beta.4":
        "published package omits @openclaw/ai required by the onboarding recovery path",
    },
  },
  whatsapp: {
    command: "whatsapp",
    defaultScenario: "whatsapp-canary",
    label: "WhatsApp",
    releaseSkipVersions: {
      "2026.4.24": "release predates the WhatsApp QA canary",
      "2026.4.25": "release predates the WhatsApp QA canary",
      "2026.4.26": "release predates the WhatsApp QA canary",
      "2026.4.27": "release predates the WhatsApp QA canary",
      "2026.4.29": "release predates the WhatsApp QA canary",
      "2026.5.2": "release predates the WhatsApp QA canary",
      "2026.5.3": "release predates the WhatsApp QA canary",
      "2026.5.4": "release predates the WhatsApp QA canary",
      "2026.5.6": "release predates the WhatsApp QA canary",
      "2026.5.7": "release predates the WhatsApp QA canary",
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
