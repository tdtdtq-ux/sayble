export type TunnelRunState =
  | "stopped"
  | "starting"
  | "running"
  | "reconnecting"
  | "failed";

export type TunnelLogLevel = "info" | "warn" | "error" | "success";

export interface TunnelConfig {
  id: string;
  name: string;
  sshHost: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  autoStart: boolean;
  autoReconnect: boolean;
  compression: boolean;
  tcpKeepAlive: boolean;
  serverAliveInterval: number;
  serverAliveCountMax: number;
  exitOnForwardFailure: boolean;
}

export interface TunnelStatus {
  id: string;
  state: TunnelRunState;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
}

export interface TunnelLogEntry {
  id: string;
  tunnelId: string;
  tunnelName: string;
  level: TunnelLogLevel;
  message: string;
  timestamp: string;
}

export interface TunnelEvent {
  kind: "status" | "log" | "deleted" | "logsCleared";
  tunnelId?: string;
  status?: TunnelStatus;
  log?: TunnelLogEntry;
}
