export const CHANNEL_RTT_DATA_DIR = "data/channel-rtt";
export const CHANNEL_RTT_RUNS_DIR = "channel-runs";

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

export function channelRttDataPath(channelId) {
  return `${CHANNEL_RTT_DATA_DIR}/${channelId}.jsonl`;
}

export function channelRttRunsDir(channelId) {
  return `${CHANNEL_RTT_RUNS_DIR}/${channelId}`;
}
