import { DEFAULT_SSH_TUNNEL_CONFIG, type SshTunnelConfig } from "./appConfig";

export type AndroidSshTunnelStatus = {
  connected: boolean;
  message: string;
};

type AndroidBridge = {
  loadSshTunnelConfig?: () => string;
  saveSshTunnelConfig?: (configJson: string) => string;
  getSshTunnelStatus?: () => string;
};

export function isAndroidSshTunnelAvailable(): boolean {
  return getAndroidBridge().saveSshTunnelConfig !== undefined;
}

export function loadAndroidSshTunnelConfig(): SshTunnelConfig | null {
  const bridge = getAndroidBridge();

  if (!bridge.loadSshTunnelConfig) {
    return null;
  }

  return parseSshTunnelConfig(bridge.loadSshTunnelConfig());
}

export function saveAndroidSshTunnelConfig(config: SshTunnelConfig): AndroidSshTunnelStatus {
  const bridge = getAndroidBridge();

  if (!bridge.saveSshTunnelConfig) {
    return { connected: false, message: "Android SSH bridge is unavailable." };
  }

  return parseSshTunnelStatus(bridge.saveSshTunnelConfig(JSON.stringify(config)));
}

export function getAndroidSshTunnelStatus(): AndroidSshTunnelStatus {
  const bridge = getAndroidBridge();

  if (!bridge.getSshTunnelStatus) {
    return { connected: false, message: "Android SSH bridge is unavailable." };
  }

  return parseSshTunnelStatus(bridge.getSshTunnelStatus());
}

function getAndroidBridge(): AndroidBridge {
  return typeof window === "undefined"
    ? {}
    : ((window as Window & { CuiAndroid?: AndroidBridge }).CuiAndroid ?? {});
}

function parseSshTunnelConfig(rawConfig: string): SshTunnelConfig {
  try {
    const parsed = JSON.parse(rawConfig) as Partial<SshTunnelConfig>;

    return {
      enabled:
        typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SSH_TUNNEL_CONFIG.enabled,
      host:
        typeof parsed.host === "string" && parsed.host.trim()
          ? parsed.host.trim()
          : DEFAULT_SSH_TUNNEL_CONFIG.host,
      port: sanitizePort(parsed.port, DEFAULT_SSH_TUNNEL_CONFIG.port),
      username:
        typeof parsed.username === "string" ? parsed.username : DEFAULT_SSH_TUNNEL_CONFIG.username,
      password:
        typeof parsed.password === "string" ? parsed.password : DEFAULT_SSH_TUNNEL_CONFIG.password,
      localPort: sanitizePort(parsed.localPort, DEFAULT_SSH_TUNNEL_CONFIG.localPort),
      remoteHost:
        typeof parsed.remoteHost === "string" && parsed.remoteHost.trim()
          ? parsed.remoteHost.trim()
          : DEFAULT_SSH_TUNNEL_CONFIG.remoteHost,
      remotePort: sanitizePort(parsed.remotePort, DEFAULT_SSH_TUNNEL_CONFIG.remotePort),
    };
  } catch {
    return { ...DEFAULT_SSH_TUNNEL_CONFIG };
  }
}

function parseSshTunnelStatus(rawStatus: string): AndroidSshTunnelStatus {
  try {
    const parsed = JSON.parse(rawStatus) as Partial<AndroidSshTunnelStatus>;

    return {
      connected: parsed.connected === true,
      message: typeof parsed.message === "string" ? parsed.message : "",
    };
  } catch {
    return { connected: false, message: "Unable to read SSH tunnel status." };
  }
}

function sanitizePort(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    return fallback;
  }

  return value;
}
