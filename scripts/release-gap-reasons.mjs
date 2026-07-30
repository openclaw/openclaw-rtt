export const DISCORD_RELEASE_PROTOCOL_GAP_REASONS = {
  "2026.4.29": "release omits Discord observed-message timing data",
  "2026.5.3": "release omits Discord observed-message timing data",
  "2026.5.16-beta.5": "release does not complete the current Discord canary",
  "2026.5.16-beta.6": "release does not complete the current Discord canary",
};

export function discordReleaseGapReason(version) {
  return DISCORD_RELEASE_PROTOCOL_GAP_REASONS[version];
}

export function channelReleaseSkipReason(channel, version) {
  return channel.releaseSkipVersions?.[version];
}
