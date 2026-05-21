export const DISCORD_RELEASE_PROTOCOL_GAP_REASONS = {
  "2026.4.29": "release omits Discord observed-message timing data",
  "2026.5.3": "release omits Discord observed-message timing data",
};

export function discordReleaseGapReason(version) {
  return DISCORD_RELEASE_PROTOCOL_GAP_REASONS[version];
}

export function channelReleaseSkipReason(channel, version) {
  return channel.releaseSkipVersions?.[version];
}
