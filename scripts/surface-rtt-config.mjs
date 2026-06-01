import { surfaceDataPath, surfaceRunsDir } from "./surface-storage.mjs";

export const SURFACE_RTT_SURFACES = {
  rpc: {
    command: "node --import tsx ../openclaw-rtt/scripts/measure-rpc-rtt.mjs --output-dir <dir>",
    defaultScenario: "rpc-gateway-smoke",
    description: "Gateway RPC request/response timing",
    label: "RPC",
  },
  "control-ui": {
    command: "pnpm openclaw qa suite --scenario control-ui-qa-channel-image-roundtrip",
    defaultScenario: "control-ui-qa-channel-image-roundtrip",
    description: "Control UI browser/Gateway timing",
    label: "Control UI",
  },
};

export function listSurfaceRttSurfaces() {
  return Object.entries(SURFACE_RTT_SURFACES).map(([id, surface]) => ({ id, ...surface }));
}

export function resolveSurfaceRttSurface(id) {
  const surface = SURFACE_RTT_SURFACES[id];
  if (!surface) {
    const known = Object.keys(SURFACE_RTT_SURFACES).sort().join(", ");
    throw new Error(`Unknown RTT surface: ${id}. Known surfaces: ${known}`);
  }
  return { id, ...surface };
}

export function surfaceRttDataPath(surfaceId, version) {
  return surfaceDataPath(surfaceId, version);
}

export function surfaceRttRunsDir(surfaceId) {
  return surfaceRunsDir(surfaceId);
}
