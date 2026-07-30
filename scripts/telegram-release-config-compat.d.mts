export function adaptTelegramReleaseGatewayConfig<T>(config: T, packageSpec: string | undefined): T;
export function resolveTelegramReleaseAuthRuntimePath(
  packageSpec: string | undefined,
): string | undefined;
export function resolveTelegramReleaseAuthRuntime(
  packageSpec: string | undefined,
): Promise<typeof import("openclaw/plugin-sdk/agent-runtime") | undefined>;
