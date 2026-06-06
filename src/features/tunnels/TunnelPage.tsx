import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Play,
  RotateCw,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  TunnelConfig,
  TunnelDirection,
  TunnelEvent,
  TunnelLogEntry,
  TunnelRunState,
  TunnelStatus,
} from "@/types/tunnel";

const statusText: Record<TunnelRunState, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  reconnecting: "重连中",
  failed: "失败",
};

const logText: Record<TunnelLogEntry["level"], string> = {
  info: "信息",
  warn: "警告",
  error: "错误",
  success: "成功",
};

const directionText: Record<TunnelDirection, string> = {
  local: "正向 -L",
  remote: "反向 -R",
};

const endpointLabels: Record<
  TunnelDirection,
  {
    listenHost: string;
    listenPort: string;
    targetHost: string;
    targetPort: string;
    listenPlaceholder: string;
    targetPlaceholder: string;
  }
> = {
  local: {
    listenHost: "本地监听地址",
    listenPort: "本地监听端口",
    targetHost: "远程目标地址",
    targetPort: "远程目标端口",
    listenPlaceholder: "127.0.0.1",
    targetPlaceholder: "rds.example.com",
  },
  remote: {
    listenHost: "远端监听地址",
    listenPort: "远端监听端口",
    targetHost: "本地目标地址",
    targetPort: "本地目标端口",
    listenPlaceholder: "127.0.0.1",
    targetPlaceholder: "127.0.0.1",
  },
};

function createTunnel(): TunnelConfig {
  return {
    id: crypto.randomUUID(),
    name: "新隧道",
    sshHost: "prod2",
    direction: "local",
    localHost: "127.0.0.1",
    localPort: 3306,
    remoteHost: "",
    remotePort: 3306,
    autoStart: false,
    autoReconnect: true,
    compression: true,
    tcpKeepAlive: true,
    serverAliveInterval: 60,
    serverAliveCountMax: 3,
    exitOnForwardFailure: true,
  };
}

function getDirection(config: TunnelConfig): TunnelDirection {
  return config.direction === "remote" ? "remote" : "local";
}

function formatEndpoint(config: TunnelConfig) {
  const direction = getDirection(config);
  const listenLabel = direction === "remote" ? "远端" : "本地";
  const targetLabel = direction === "remote" ? "本地" : "远端";
  return `${directionText[direction]} ${listenLabel} ${config.localHost || "127.0.0.1"}:${config.localPort} -> ${targetLabel} ${config.remoteHost || "未配置"}:${config.remotePort}`;
}

function formatSshCommand(config: TunnelConfig) {
  const direction = getDirection(config);
  const spec = config.localHost.trim()
    ? `${config.localHost}:${config.localPort}:${config.remoteHost || "<target-host>"}:${config.remotePort}`
    : `${config.localPort}:${config.remoteHost || "<target-host>"}:${config.remotePort}`;
  const args = [
    "ssh",
    "-N",
    direction === "remote" ? "-R" : "-L",
    spec,
    "-o",
    `TCPKeepAlive=${config.tcpKeepAlive ? "yes" : "no"}`,
    "-o",
    `ServerAliveInterval=${config.serverAliveInterval}`,
    "-o",
    `ServerAliveCountMax=${config.serverAliveCountMax}`,
    "-o",
    `ExitOnForwardFailure=${config.exitOnForwardFailure ? "yes" : "no"}`,
  ];
  if (config.compression) {
    args.push("-C");
  }
  args.push(config.sshHost || "<ssh-host>");
  return args.join(" ");
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function formatDuration(startedAt: string | null) {
  if (!startedAt) return "";
  const elapsed = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getBadgeVariant(state: TunnelRunState): "default" | "secondary" | "destructive" | "outline" {
  if (state === "running") return "default";
  if (state === "failed") return "destructive";
  if (state === "stopped") return "outline";
  return "secondary";
}

function validateDraft(config: TunnelConfig) {
  if (!config.name.trim()) return "请填写隧道名称";
  if (!config.sshHost.trim()) return "请填写 SSH 主机";
  if (!config.remoteHost.trim()) {
    return getDirection(config) === "remote" ? "请填写本地目标地址" : "请填写远程目标地址";
  }
  if (!config.localPort || config.localPort < 1 || config.localPort > 65535) {
    return getDirection(config) === "remote"
      ? "远端监听端口必须在 1-65535 之间"
      : "本地监听端口必须在 1-65535 之间";
  }
  if (!config.remotePort || config.remotePort < 1 || config.remotePort > 65535) {
    return getDirection(config) === "remote"
      ? "本地目标端口必须在 1-65535 之间"
      : "远程目标端口必须在 1-65535 之间";
  }
  return null;
}

function toPort(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(65535, Math.trunc(parsed)));
}

export function TunnelPage() {
  const [tunnels, setTunnels] = useState<TunnelConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, TunnelStatus>>({});
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<TunnelConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [logs, setLogs] = useState<TunnelLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const activeIdRef = useRef("");
  const dirtyRef = useRef(false);

  const activeSavedTunnel = tunnels.find((item) => item.id === activeId) ?? null;
  const isUnsaved = Boolean(draft && !activeSavedTunnel);
  const activeStatus = statuses[activeId] ?? {
    id: activeId,
    state: "stopped" as const,
    pid: null,
    startedAt: null,
    lastError: null,
    reconnectAttempt: 0,
  };
  const isRunning =
    activeStatus.state === "running" ||
    activeStatus.state === "starting" ||
    activeStatus.state === "reconnecting";

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const visibleTunnels = useMemo(() => {
    if (draft && !tunnels.some((item) => item.id === draft.id)) {
      return [draft, ...tunnels];
    }
    return tunnels;
  }, [draft, tunnels]);

  const loadLogs = useCallback(async (id: string) => {
    if (!id) {
      setLogs([]);
      return;
    }
    try {
      const result = await invoke<TunnelLogEntry[]>("cmd_load_tunnel_logs", {
        tunnelId: id,
        limit: 200,
      });
      setLogs(result);
    } catch (err) {
      console.error("load tunnel logs failed:", err);
    }
  }, []);

  const loadTunnels = useCallback(async () => {
    setLoading(true);
    try {
      const [nextTunnels, nextStatuses] = await Promise.all([
        invoke<TunnelConfig[]>("cmd_list_tunnels"),
        invoke<TunnelStatus[]>("cmd_get_tunnel_statuses"),
      ]);
      const statusMap = Object.fromEntries(nextStatuses.map((item) => [item.id, item]));
      setTunnels(nextTunnels);
      setStatuses(statusMap);

      const currentActiveId = activeIdRef.current;
      const nextActiveId = nextTunnels.some((item) => item.id === currentActiveId)
        ? currentActiveId
        : nextTunnels[0]?.id || "";
      setActiveId(nextActiveId);
      if (nextActiveId && !dirtyRef.current) {
        setDraft(nextTunnels.find((item) => item.id === nextActiveId) ?? null);
      }
      if (nextActiveId) {
        await loadLogs(nextActiveId);
      }
    } catch (err) {
      toast.error(`加载隧道失败: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [loadLogs]);

  useEffect(() => {
    loadTunnels();
  }, [loadTunnels]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<TunnelEvent>("tunnel-event", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.kind === "status" && payload.status) {
        setStatuses((prev) => ({ ...prev, [payload.status!.id]: payload.status! }));
      }
      if (payload.kind === "log" && payload.log && payload.tunnelId === activeId) {
        setLogs((prev) => [payload.log!, ...prev].slice(0, 200));
      }
      if (payload.kind === "deleted") {
        loadTunnels();
      }
      if (payload.kind === "logsCleared" && (!payload.tunnelId || payload.tunnelId === activeId)) {
        setLogs([]);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeId, loadTunnels]);

  const selectTunnel = (config: TunnelConfig) => {
    setActiveId(config.id);
    setDraft(config);
    setDirty(false);
    setDeleteArmed(false);
    loadLogs(config.id);
  };

  const updateDraft = <K extends keyof TunnelConfig>(key: K, value: TunnelConfig[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };

  const saveDraft = async () => {
    if (!draft) return null;
    const validation = validateDraft(draft);
    if (validation) {
      toast.error(validation);
      return null;
    }

    setBusy("save");
    try {
      const saved = await invoke<TunnelConfig>("cmd_save_tunnel", { config: draft });
      setTunnels((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        return exists ? prev.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...prev];
      });
      setDraft(saved);
      setActiveId(saved.id);
      setDirty(false);
      toast.success("隧道配置已保存");
      return saved;
    } catch (err) {
      toast.error(`保存失败: ${err}`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const ensureSaved = async () => {
    if (!draft) return null;
    if (dirty || isUnsaved) return saveDraft();
    return draft;
  };

  const startTunnel = async () => {
    const config = await ensureSaved();
    if (!config) return;
    setBusy("start");
    try {
      await invoke("cmd_start_tunnel", { id: config.id });
      toast.success("隧道正在启动");
    } catch (err) {
      toast.error(`启动失败: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const stopTunnel = async () => {
    if (!draft) return;
    setBusy("stop");
    try {
      await invoke("cmd_stop_tunnel", { id: draft.id });
      toast.success("隧道已停止");
    } catch (err) {
      toast.error(`停止失败: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const restartTunnel = async () => {
    const config = await ensureSaved();
    if (!config) return;
    setBusy("restart");
    try {
      await invoke("cmd_restart_tunnel", { id: config.id });
      toast.success("隧道正在重启");
    } catch (err) {
      toast.error(`重启失败: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const deleteTunnel = async () => {
    if (!draft) return;
    if (isUnsaved) {
      setDraft(tunnels[0] ?? null);
      setActiveId(tunnels[0]?.id ?? "");
      setDirty(false);
      setDeleteArmed(false);
      return;
    }
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }

    setBusy("delete");
    try {
      await invoke("cmd_delete_tunnel", { id: draft.id });
      const remaining = tunnels.filter((item) => item.id !== draft.id);
      setTunnels(remaining);
      setDraft(remaining[0] ?? null);
      setActiveId(remaining[0]?.id ?? "");
      setDirty(false);
      setDeleteArmed(false);
      toast.success("隧道已删除");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    } finally {
      setBusy(null);
    }
  };

  const clearLogs = async () => {
    if (!activeId) return;
    try {
      await invoke("cmd_clear_tunnel_logs", { tunnelId: activeId });
      setLogs([]);
      toast.success("日志已清空");
    } catch (err) {
      toast.error(`清空日志失败: ${err}`);
    }
  };

  const draftDirection = draft ? getDirection(draft) : "local";
  const labels = endpointLabels[draftDirection];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">SSH 隧道</h2>
          <span className="text-xs text-muted-foreground">
            {tunnels.length} 条配置
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = createTunnel();
            setDraft(next);
            setActiveId(next.id);
            setDirty(true);
            setDeleteArmed(false);
            setLogs([]);
          }}
        >
          <Plus data-icon="inline-start" />
          新建
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto custom-scrollbar pb-4 pl-6 pr-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>
          ) : visibleTunnels.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              还没有隧道，点右上角新建。
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {visibleTunnels.map((config) => {
                const status = statuses[config.id] ?? {
                  id: config.id,
                  state: "stopped" as const,
                  pid: null,
                  startedAt: null,
                  lastError: null,
                  reconnectAttempt: 0,
                };
                const endpoint = formatEndpoint(config);

                return (
                  <button
                    key={config.id}
                    onClick={() => selectTunnel(config)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      activeId === config.id
                        ? "border-primary bg-muted text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{config.name}</span>
                      <Badge variant={getBadgeVariant(status.state)} className="shrink-0 px-1.5 py-0 text-[10px]">
                        {statusText[status.state]}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">{endpoint}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                      SSH: {config.sshHost || "未配置"}
                      {status.state === "running" && status.startedAt ? ` · ${formatDuration(status.startedAt)}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
          {!draft ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              选择或新建一个隧道
            </div>
          ) : (
            <div className="flex min-h-full flex-col gap-4">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-lg font-semibold">{draft.name || "未命名隧道"}</h3>
                    {isUnsaved && <Badge variant="outline">未保存</Badge>}
                    {dirty && !isUnsaved && <Badge variant="secondary">已修改</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {formatEndpoint(draft)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={getBadgeVariant(activeStatus.state)}>
                    {statusText[activeStatus.state]}
                  </Badge>
                  {isRunning ? (
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={stopTunnel}>
                      <Square data-icon="inline-start" />
                      停止
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy !== null} onClick={startTunnel}>
                      <Play data-icon="inline-start" />
                      启动
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={restartTunnel}>
                    <RotateCw data-icon="inline-start" />
                    重启
                  </Button>
                </div>
              </div>

              {activeStatus.lastError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {activeStatus.lastError}
                </div>
              )}

              <div className="rounded-md bg-muted/50 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-name">名称</Label>
                    <Input
                      id="tunnel-name"
                      value={draft.name}
                      onChange={(event) => updateDraft("name", event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-ssh-host">SSH 主机</Label>
                    <Input
                      id="tunnel-ssh-host"
                      value={draft.sshHost}
                      placeholder="prod2"
                      onChange={(event) => updateDraft("sshHost", event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-direction">转发方向</Label>
                    <ToggleGroup
                      id="tunnel-direction"
                      type="single"
                      variant="outline"
                      size="sm"
                      value={draftDirection}
                      onValueChange={(value) => {
                        if (value === "local" || value === "remote") {
                          updateDraft("direction", value);
                        }
                      }}
                    >
                      <ToggleGroupItem value="local" aria-label="正向转发">
                        正向 -L
                      </ToggleGroupItem>
                      <ToggleGroupItem value="remote" aria-label="反向转发">
                        反向 -R
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-local-host">{labels.listenHost}</Label>
                    <Input
                      id="tunnel-local-host"
                      value={draft.localHost}
                      placeholder={labels.listenPlaceholder}
                      onChange={(event) => updateDraft("localHost", event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-local-port">{labels.listenPort}</Label>
                    <Input
                      id="tunnel-local-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={draft.localPort || ""}
                      onChange={(event) => updateDraft("localPort", toPort(event.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-remote-host">{labels.targetHost}</Label>
                    <Input
                      id="tunnel-remote-host"
                      value={draft.remoteHost}
                      placeholder={labels.targetPlaceholder}
                      onChange={(event) => updateDraft("remoteHost", event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-remote-port">{labels.targetPort}</Label>
                    <Input
                      id="tunnel-remote-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={draft.remotePort || ""}
                      onChange={(event) => updateDraft("remotePort", toPort(event.target.value))}
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-1.5">
                  <Label htmlFor="tunnel-command-preview">命令预览</Label>
                  <Input
                    id="tunnel-command-preview"
                    readOnly
                    value={formatSshCommand(draft)}
                    className="font-mono text-xs"
                  />
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-2 gap-3">
                  <SwitchRow
                    label="打开应用时自动启动"
                    checked={draft.autoStart}
                    onChange={(value) => updateDraft("autoStart", value)}
                  />
                  <SwitchRow
                    label="断开后自动重连"
                    checked={draft.autoReconnect}
                    onChange={(value) => updateDraft("autoReconnect", value)}
                  />
                  <SwitchRow
                    label="压缩传输 -C"
                    checked={draft.compression}
                    onChange={(value) => updateDraft("compression", value)}
                  />
                  <SwitchRow
                    label="TCPKeepAlive"
                    checked={draft.tcpKeepAlive}
                    onChange={(value) => updateDraft("tcpKeepAlive", value)}
                  />
                  <SwitchRow
                    label="ExitOnForwardFailure"
                    checked={draft.exitOnForwardFailure}
                    onChange={(value) => updateDraft("exitOnForwardFailure", value)}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-interval">ServerAliveInterval</Label>
                    <Input
                      id="tunnel-interval"
                      type="number"
                      min={1}
                      value={draft.serverAliveInterval || ""}
                      onChange={(event) => updateDraft("serverAliveInterval", Math.max(0, Number(event.target.value) || 0))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tunnel-count">ServerAliveCountMax</Label>
                    <Input
                      id="tunnel-count"
                      type="number"
                      min={1}
                      value={draft.serverAliveCountMax || ""}
                      onChange={(event) => updateDraft("serverAliveCountMax", Math.max(0, Number(event.target.value) || 0))}
                    />
                  </div>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="outline" disabled={busy !== null || (!dirty && !isUnsaved)} onClick={saveDraft}>
                    <Save data-icon="inline-start" />
                    保存
                  </Button>
                  <Button variant={deleteArmed ? "destructive" : "outline"} disabled={busy !== null} onClick={deleteTunnel}>
                    <Trash2 data-icon="inline-start" />
                    {deleteArmed ? "确认删除" : "删除"}
                  </Button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col rounded-md border">
                <div className="flex shrink-0 items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">本地日志</h3>
                    <span className="text-xs text-muted-foreground">{logs.length} 条</span>
                  </div>
                  <Button variant="ghost" size="xs" disabled={!logs.length} onClick={clearLogs}>
                    清空
                  </Button>
                </div>
                <Separator />
                <div className="max-h-64 overflow-y-auto custom-scrollbar p-3">
                  {logs.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">暂无日志</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {logs.map((entry) => (
                        <div key={entry.id} className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                          <div className="mb-1 flex items-center gap-2">
                            <Badge variant={entry.level === "error" ? "destructive" : entry.level === "warn" ? "secondary" : "outline"} className="px-1.5 py-0 text-[10px]">
                              {logText[entry.level]}
                            </Badge>
                            <span className="font-display-num text-muted-foreground">{formatTime(entry.timestamp)}</span>
                          </div>
                          <div className="break-all text-sm leading-relaxed">{entry.message}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SwitchRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SwitchRow({ label, checked, onChange }: SwitchRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
