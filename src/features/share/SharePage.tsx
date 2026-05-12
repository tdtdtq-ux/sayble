import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl } from "@tauri-apps/plugin-opener";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileDown,
  FolderOpen,
  Play,
  QrCode,
  Square,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { ShareServerState, SharedFile } from "@/types/share";

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function fileLabel(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function downloadUrl(baseUrl: string, id: string) {
  return `${baseUrl.replace(/\/$/, "")}/download/${encodeURIComponent(id)}`;
}

export function SharePage() {
  const [state, setState] = useState<ShareServerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [portInput, setPortInput] = useState("17321");
  const [statusMessage, setStatusMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const files = state?.files ?? [];
  const hosts = state?.hosts ?? [];
  const running = state?.running ?? false;
  const shareUrl = running ? state?.baseUrl ?? "" : "";
  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<ShareServerState>("cmd_get_share_state");
      setState(result);
      setPortInput(String(result.port));
      if (result.lastError) {
        setStatusMessage({ kind: "error", text: result.lastError });
      } else {
        setStatusMessage(null);
      }
    } catch (err) {
      toast.error(`加载共享服务失败: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const addPaths = useCallback(async (paths: string[]) => {
    const filePaths = paths.filter(Boolean);
    if (filePaths.length === 0) return;

    setBusy(true);
    let nextState: ShareServerState | null = null;
    let successCount = 0;
    for (const path of filePaths) {
      try {
        nextState = await invoke<ShareServerState>("cmd_add_share_file", { path });
        successCount += 1;
      } catch (err) {
        toast.error(`${fileLabel(path)} 共享失败: ${err}`);
      }
    }
    if (nextState) {
      setState(nextState);
      toast.success(successCount === 1 ? "文件已加入共享" : `${successCount} 个文件已加入共享`);
    } else {
      await loadState();
    }
    setBusy(false);
  }, [loadState]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    if (!shareUrl) {
      setQrDataUrl("");
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(shareUrl, {
      width: 216,
      margin: 1,
      color: {
        dark: "#171717",
        light: "#ffffff",
      },
    }).then((value) => {
      if (!cancelled) setQrDataUrl(value);
    }).catch((err) => {
      console.error("generate qr failed:", err);
      if (!cancelled) setQrDataUrl("");
    });

    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setDragActive(true);
      } else if (payload.type === "leave") {
        setDragActive(false);
      } else if (payload.type === "drop") {
        setDragActive(false);
        void addPaths(payload.paths);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch((err) => {
      console.error("register share drop listener failed:", err);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addPaths]);

  const preventDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const copyText = async (value: string, message: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch (err) {
      toast.error(`复制失败: ${err}`);
    }
  };

  const copyShareUrl = () => {
    void copyText(shareUrl, "链接已复制");
  };

  const startServer = async () => {
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      const message = "端口必须在 1-65535 之间";
      setStatusMessage({ kind: "error", text: message });
      toast.error(message);
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    try {
      const result = await invoke<ShareServerState>("cmd_start_share_server", { port });
      setState(result);
      setPortInput(String(result.port));
      setStatusMessage({ kind: "success", text: `服务已启动: ${result.baseUrl}` });
      toast.success("共享服务已启动");
    } catch (err) {
      const message = String(err);
      setStatusMessage({ kind: "error", text: message });
      toast.error(`启动失败: ${message}`);
      await loadState();
    } finally {
      setBusy(false);
    }
  };

  const stopServer = async () => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_stop_share_server");
      setState(result);
      setPortInput(String(result.port));
      setStatusMessage({ kind: "success", text: "服务已停止" });
      toast.success("共享服务已停止");
    } catch (err) {
      toast.error(`停止失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const clearFiles = async () => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_clear_share_files");
      setState(result);
      toast.success("共享列表已清空");
    } catch (err) {
      toast.error(`清空失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const selectHost = async (address: string) => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_set_share_host", { address });
      setState(result);
      toast.success("二维码地址已切换");
    } catch (err) {
      toast.error(`切换 IP 失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async (file: SharedFile) => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_remove_share_file", { id: file.id });
      setState(result);
      toast.success("文件已移出共享");
    } catch (err) {
      toast.error(`移除失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={preventDrop}
      onDrop={(event) => {
        preventDrop(event);
        setDragActive(false);
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">共享</h2>
          <Badge variant="outline" className="gap-1">
            <Wifi className="size-3" />
            {state ? (running ? `${state.host}:${state.port}` : "服务未启动") : "加载中"}
          </Badge>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div
            className={`flex min-h-40 shrink-0 flex-col items-center justify-center rounded-md border border-dashed px-5 py-8 text-center transition-colors ${
              dragActive && running ? "border-primary bg-muted" : "bg-muted/35"
            }`}
            onDragEnter={preventDrop}
            onDragOver={preventDrop}
          >
            <div className="mb-3 flex size-12 items-center justify-center rounded-md bg-background shadow-xs">
              <Upload className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">
              {dragActive ? "松手加入共享" : "把 APK 或其他文件拖到这里"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {running ? "手机扫码打开 H5 后可直接下载" : "先启动服务，再扫码下载"}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-md border">
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">共享文件</h3>
                <span className="text-xs text-muted-foreground">
                  {files.length} 个 · {formatFileSize(totalSize)}
                </span>
              </div>
              <Button variant="ghost" size="xs" disabled={busy || files.length === 0} onClick={clearFiles}>
                清空
              </Button>
            </div>
            <Separator />
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-3">
              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
              ) : files.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">还没有共享文件</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {files.map((file) => (
                    <div key={file.id} className="rounded-md bg-muted/40 px-3 py-2">
                      <div className="flex items-start gap-3">
                        <FileDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{file.name}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{file.path}</div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/80">
                            <span>{formatFileSize(file.size)}</span>
                            {formatTime(file.addedAt) && <span>{formatTime(file.addedAt)}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={!shareUrl}
                            title="复制下载链接"
                            onClick={() => void copyText(downloadUrl(shareUrl, file.id), "下载链接已复制")}
                          >
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={busy}
                            title="移出共享"
                            onClick={() => void removeFile(file)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="flex w-72 shrink-0 flex-col rounded-md border bg-muted/30">
          <div className="flex items-center gap-2 px-4 py-3">
            <QrCode className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">手机扫码</h3>
          </div>
          <Separator />
          <div className="flex shrink-0 flex-col gap-3 px-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-port">服务端口</Label>
              <Input
                id="share-port"
                type="number"
                min={1}
                max={65535}
                value={portInput}
                disabled={running || busy}
                onChange={(event) => setPortInput(event.target.value)}
              />
            </div>
            {running ? (
              <Button variant="outline" disabled={busy} onClick={stopServer}>
                <Square data-icon="inline-start" />
                停止服务
              </Button>
            ) : (
              <Button disabled={busy} onClick={startServer}>
                <Play data-icon="inline-start" />
                启动服务
              </Button>
            )}
            {statusMessage && (
              <div
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  statusMessage.kind === "success"
                    ? "border-border bg-background text-foreground"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {statusMessage.kind === "success" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                )}
                <span className="break-all">{statusMessage.text}</span>
              </div>
            )}
          </div>
          {running && (
            <>
              <Separator />
              <div className="flex shrink-0 flex-col gap-2 px-4 py-3">
                <div className="text-xs text-muted-foreground">二维码 IP</div>
                <Select value={state?.host ?? ""} disabled={!state || busy} onValueChange={selectHost}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择 IP" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {hosts.map((host) => (
                        <SelectItem key={host.address} value={host.address}>
                          {host.address} · {host.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-5">
                <div className="flex size-56 items-center justify-center rounded-md bg-background p-3 shadow-xs">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="共享下载页二维码" className="size-full" />
                  ) : (
                    <span className="text-sm text-muted-foreground">二维码生成中</span>
                  )}
                </div>
                <div className="w-full rounded-md bg-background px-3 py-2 text-center">
                  <div className="truncate font-display-num text-xs text-muted-foreground">{shareUrl}</div>
                </div>
                <div className="grid w-full grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" disabled={!shareUrl} onClick={copyShareUrl}>
                    <Copy data-icon="inline-start" />
                    复制
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!shareUrl}
                    onClick={() => {
                      if (shareUrl) void openUrl(shareUrl);
                    }}
                  >
                    <ExternalLink data-icon="inline-start" />
                    打开
                  </Button>
                </div>
                <p className="text-center text-xs leading-relaxed text-muted-foreground">
                  电脑和手机需要在同一个局域网
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
