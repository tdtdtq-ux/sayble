import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Share2, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ShareContentItem, ShareServerState, ShareUploadRecord, SharedFile } from "@/types/share";
import { ContentTransferTab } from "./ContentTransferTab";
import { LocalShareTab } from "./LocalShareTab";
import { MobileUploadTab } from "./MobileUploadTab";
import { ShareServicePanel } from "./ShareServicePanel";
import { fileLabel, mergeContent, mergeUpload } from "./shareUtils";

export function SharePage() {
  const [state, setState] = useState<ShareServerState | null>(null);
  const [activeTab, setActiveTab] = useState("local");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [portInput, setPortInput] = useState("17321");
  const [contentDraft, setContentDraft] = useState("");
  const [statusMessage, setStatusMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pendingDeleteUpload, setPendingDeleteUpload] = useState<ShareUploadRecord | null>(null);
  const [deleteOriginalFile, setDeleteOriginalFile] = useState(false);

  const files = state?.files ?? [];
  const uploads = state?.uploads ?? [];
  const contents = state?.contents ?? [];
  const hosts = state?.hosts ?? [];
  const running = state?.running ?? false;
  const shareUrl = running ? state?.baseUrl ?? "" : "";
  const uploadSaveDir = state?.uploadSaveDir ?? "";
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  const pendingUploads = uploads.filter((upload) => upload.status === "pending");
  const activeUploads = uploads.filter((upload) => upload.status === "accepted" || upload.status === "uploading");
  const uploadHistory = uploads.filter((upload) =>
    upload.status === "completed" || upload.status === "rejected" || upload.status === "failed",
  );

  const pendingBatches = useMemo(() => {
    const groups = new Map<string, ShareUploadRecord[]>();
    for (const upload of pendingUploads) {
      groups.set(upload.batchId, [...(groups.get(upload.batchId) ?? []), upload]);
    }
    return Array.from(groups.entries());
  }, [pendingUploads]);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<ShareServerState>("cmd_get_share_state");
      setState(result);
      setPortInput(String(result.port));
      setStatusMessage(result.lastError ? { kind: "error", text: result.lastError } : null);
    } catch (err) {
      toast.error(`加载共享服务失败: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const chooseUploadDir = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择手机上传保存目录",
      });
      if (!selected || Array.isArray(selected)) return null;
      const result = await invoke<ShareServerState>("cmd_set_share_upload_dir", { path: selected });
      setState(result);
      toast.success("上传保存目录已设置");
      return result;
    } catch (err) {
      toast.error(`设置上传目录失败: ${err}`);
      return null;
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
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const register = async () => {
      unlisteners.push(await listen<{ uploads: ShareUploadRecord[] }>("share-upload-request", (event) => {
        if (cancelled) return;
        setActiveTab("mobile");
        setState((current) => {
          let next = current;
          for (const upload of event.payload.uploads) {
            next = mergeUpload(next, upload);
          }
          return next;
        });
        toast.info(`${event.payload.uploads.length} 个文件等待接收`);
      }));

      for (const eventName of ["share-upload-progress", "share-upload-finished", "share-upload-changed"]) {
        unlisteners.push(await listen<ShareUploadRecord>(eventName, (event) => {
          if (cancelled) return;
          setState((current) => mergeUpload(current, event.payload));
        }));
      }

      unlisteners.push(await listen<ShareContentItem>("share-content-received", (event) => {
        if (cancelled) return;
        setActiveTab("content");
        setState((current) => mergeContent(current, event.payload));
        toast.info("手机发来一段内容");
      }));
      unlisteners.push(await listen<ShareContentItem>("share-content-changed", (event) => {
        if (cancelled) return;
        setState((current) => mergeContent(current, event.payload));
      }));
    };

    register().catch((err) => console.error("register share upload listener failed:", err));
    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

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
      let currentState = state;
      if (!currentState?.uploadSaveDir) {
        currentState = await chooseUploadDir();
        if (!currentState?.uploadSaveDir) {
          const message = "请先设置手机上传保存目录";
          setStatusMessage({ kind: "error", text: message });
          toast.error(message);
          return;
        }
      }
      const result = await invoke<ShareServerState>("cmd_start_share_server", { port });
      setState(result);
      setPortInput(String(result.port));
      setStatusMessage(null);
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
      setStatusMessage(null);
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

  const clearUploads = async () => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_clear_share_uploads");
      setState(result);
      toast.success("上传记录已清空");
    } catch (err) {
      toast.error(`清空失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const requestDeleteUpload = (upload: ShareUploadRecord) => {
    setPendingDeleteUpload(upload);
    setDeleteOriginalFile(false);
  };

  const deleteUpload = async () => {
    if (!pendingDeleteUpload) return;
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_delete_share_upload", {
        id: pendingDeleteUpload.id,
        deleteFile: deleteOriginalFile,
      });
      setState(result);
      setPendingDeleteUpload(null);
      setDeleteOriginalFile(false);
      toast.success(deleteOriginalFile ? "上传记录和原文件已删除" : "上传记录已删除");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
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

  const uploadAction = async (command: string, args: Record<string, string>, message: string) => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>(command, args);
      setState(result);
      toast.success(message);
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const sendContent = async () => {
    const text = contentDraft;
    if (!text.trim()) return;
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_add_share_content", { text });
      setState(result);
      setContentDraft("");
      toast.success("内容已发送到手机");
    } catch (err) {
      toast.error(`发送失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const removeContent = async (id: string) => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_remove_share_content", { id });
      setState(result);
      toast.success("内容已删除");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const clearContents = async () => {
    setBusy(true);
    try {
      const result = await invoke<ShareServerState>("cmd_clear_share_contents");
      setState(result);
      toast.success("内容记录已清空");
    } catch (err) {
      toast.error(`清空失败: ${err}`);
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
      <div className="flex min-h-0 flex-1 gap-4 px-5 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 min-w-0 flex-1">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Share2 className="size-4 text-muted-foreground" />
                共享
              </div>
              <TabsList>
                <TabsTrigger value="local">本地共享</TabsTrigger>
                <TabsTrigger value="mobile">手机上传</TabsTrigger>
                <TabsTrigger value="content">内容互传</TabsTrigger>
              </TabsList>
            </div>
            <Badge variant="outline" className="shrink-0 gap-1">
              <Wifi className="size-3" />
              {state ? (running ? `${state.host}:${state.port}` : "未启动") : "加载中"}
            </Badge>
          </div>

          <TabsContent value="local" className="min-h-0">
            <LocalShareTab
              files={files}
              loading={loading}
              busy={busy}
              dragActive={dragActive}
              shareUrl={shareUrl}
              totalSize={totalSize}
              onPreventDrop={preventDrop}
              onClearFiles={clearFiles}
              onCopyText={copyText}
              onRemoveFile={removeFile}
            />
          </TabsContent>

          <TabsContent value="mobile" className="min-h-0">
            <MobileUploadTab
              uploadSaveDir={uploadSaveDir}
              pendingUploads={pendingUploads}
              pendingBatches={pendingBatches}
              activeUploads={activeUploads}
              uploadHistory={uploadHistory}
              busy={busy}
              running={running}
              onChooseUploadDir={chooseUploadDir}
              onClearUploads={clearUploads}
              onDeleteUpload={requestDeleteUpload}
              onUploadAction={uploadAction}
            />
          </TabsContent>

          <TabsContent value="content" className="min-h-0">
            <ContentTransferTab
              contents={contents}
              draft={contentDraft}
              busy={busy}
              onDraftChange={setContentDraft}
              onSend={sendContent}
              onCopyText={copyText}
              onRemove={removeContent}
              onClear={clearContents}
            />
          </TabsContent>
        </Tabs>

        <ShareServicePanel
          running={running}
          busy={busy}
          host={state?.host ?? ""}
          port={state?.port}
          hosts={hosts}
          portInput={portInput}
          qrDataUrl={qrDataUrl}
          shareUrl={shareUrl}
          statusMessage={statusMessage}
          onPortInputChange={setPortInput}
          onStartServer={startServer}
          onStopServer={stopServer}
          onSelectHost={selectHost}
          onCopyText={copyText}
        />
      </div>
      <Dialog
        open={pendingDeleteUpload !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteUpload(null);
            setDeleteOriginalFile(false);
          }
        }}
      >
        <DialogContent className="w-[min(calc(100vw-2rem),32rem)] max-w-[calc(100vw-2rem)] overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle>删除上传记录</DialogTitle>
            <DialogDescription>
              删除记录不会影响手机端录像列表。
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-3">
            <div className="min-w-0 overflow-hidden rounded-md bg-muted/50 px-3 py-2 text-sm">
              <div className="min-w-0 truncate font-medium" title={pendingDeleteUpload?.name}>
                {pendingDeleteUpload?.name}
              </div>
              <div
                className="mt-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                title={pendingDeleteUpload?.path || undefined}
              >
                {pendingDeleteUpload?.path || "没有本地文件路径"}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-border"
                checked={deleteOriginalFile}
                disabled={!pendingDeleteUpload?.path}
                onChange={(event) => setDeleteOriginalFile(event.target.checked)}
              />
              同时删除本地原文件
            </label>
          </div>
          <div className="flex w-full min-w-0 justify-end gap-2 pt-1">
            <Button
              variant="outline"
              className="w-16"
              disabled={busy}
              onClick={() => {
                setPendingDeleteUpload(null);
                setDeleteOriginalFile(false);
              }}
            >
              取消
            </Button>
            <Button className="w-16" variant="destructive" disabled={busy} onClick={() => void deleteUpload()}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
