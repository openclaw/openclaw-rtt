export function adaptReleaseGatewayConfig<T>(config: T, packageSpec: string | undefined): T;
export function resolveReleaseAuthRuntimePath(
  packageSpec: string | undefined,
  runtimePath: string | undefined,
): string | undefined;
export function resolveReleaseAuthRuntime(
  packageSpec: string | undefined,
  runtimePath: string | undefined,
): Promise<typeof import("openclaw/plugin-sdk/agent-runtime") | undefined>;
