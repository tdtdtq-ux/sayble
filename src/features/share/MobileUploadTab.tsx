import type { ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, FileDown, FolderOpen, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ShareUploadRecord } from "@/types/share";
import { formatDuration, formatFileSize, formatTime, statusLabel, uploadPercent } from "./shareUtils";

interface MobileUploadTabProps {
  uploadSaveDir: string;
  pendingUploads: ShareUploadRecord[];
  pendingBatches: Array<[string, ShareUploadRecord[]]>;
  activeUploads: ShareUploadRecord[];
  uploadHistory: ShareUploadRecord[];
  busy: boolean;
  running: boolean;
  onChooseUploadDir: () => void | Promise<unknown>;
  onClearUploads: () => void;
  onDeleteUpload: (upload: ShareUploadRecord) => void | Promise<void>;
  onUploadAction: (command: string, args: Record<string, string>, message: string) => void | Promise<void>;
}

export function MobileUploadTab({
  uploadSaveDir,
  pendingUploads,
  pendingBatches,
  activeUploads,
  uploadHistory,
  busy,
  running,
  onChooseUploadDir,
  onClearUploads,
  onDeleteUpload,
  onUploadAction,
}: MobileUploadTabProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs defaultValue="pending" className="min-h-0 flex-1">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="pending">待接收 {pendingUploads.length}</TabsTrigger>
            <TabsTrigger value="active">上传中 {activeUploads.length}</TabsTrigger>
            <TabsTrigger value="history">上传记录 {uploadHistory.length}</TabsTrigger>
          </TabsList>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <span className="truncate text-xs text-muted-foreground">{uploadSaveDir || "未设置保存目录"}</span>
            <Button variant="outline" size="xs" disabled={busy || running} onClick={() => void onChooseUploadDir()}>
              <FolderOpen data-icon="inline-start" />
              设置
            </Button>
          </div>
        </div>

        <TabsContent value="pending" className="min-h-0">
          <UploadList count={pendingUploads.length} empty="暂无待接收上传">
            {pendingBatches.map(([batchId, records]) => (
              <div key={batchId} className="rounded-md bg-muted/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    {records[0]?.sourceIp} · {records.length} 个 ·{" "}
                    {formatFileSize(records.reduce((sum, item) => sum + item.size, 0))}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() => void onUploadAction("cmd_accept_share_upload_batch", { batchId }, "已接收这批文件")}
                    >
                      <Check data-icon="inline-start" />
                      全部接收
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() => void onUploadAction("cmd_reject_share_upload_batch", { batchId }, "已拒绝这批文件")}
                    >
                      <X data-icon="inline-start" />
                      全部拒绝
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {records.map((upload) => (
                    <UploadRow
                      key={upload.id}
                      upload={upload}
                      busy={busy}
                      onAccept={() => onUploadAction("cmd_accept_share_upload", { id: upload.id }, "已接收上传")}
                      onReject={() => onUploadAction("cmd_reject_share_upload", { id: upload.id }, "已拒绝上传")}
                    />
                  ))}
                </div>
              </div>
            ))}
          </UploadList>
        </TabsContent>

        <TabsContent value="active" className="min-h-0">
          <UploadList count={activeUploads.length} empty="暂无正在上传的文件">
            {activeUploads.map((upload) => (
              <UploadRow key={upload.id} upload={upload} busy={busy} />
            ))}
          </UploadList>
        </TabsContent>

        <TabsContent value="history" className="min-h-0">
          <UploadList
            count={uploadHistory.length}
            empty="暂无上传记录"
            action={
              <Button variant="ghost" size="xs" disabled={busy || uploadHistory.length === 0} onClick={onClearUploads}>
                清空记录
              </Button>
            }
          >
            {uploadHistory.map((upload) => (
              <UploadRow
                key={upload.id}
                upload={upload}
                busy={busy}
                onDelete={() => onDeleteUpload(upload)}
                showHistoryActions
              />
            ))}
          </UploadList>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UploadList({
  count,
  empty,
  action,
  children,
}: {
  count: number;
  empty: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border">
      {action && (
        <>
          <div className="flex shrink-0 items-center justify-end px-4 py-2.5">{action}</div>
          <Separator />
        </>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-3">
        {count === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <div className="flex flex-col gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}

function UploadRow({
  upload,
  busy,
  onAccept,
  onReject,
  onDelete,
  showHistoryActions = false,
}: {
  upload: ShareUploadRecord;
  busy: boolean;
  onAccept?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  showHistoryActions?: boolean;
}) {
  const percent = uploadPercent(upload);
  const failed = upload.status === "failed";
  const rejected = upload.status === "rejected";
  const completed = upload.status === "completed";
  const durationLabel = formatDuration(upload.durationSeconds);

  const openUploadedFile = async () => {
    if (!upload.path) return;
    try {
      await revealItemInDir(upload.path);
    } catch (err) {
      toast.error(`打开文件夹失败: ${err}`);
    }
  };

  return (
    <div className="rounded-md bg-background px-3 py-2">
      <div className="flex items-start gap-3">
        <FileDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium">{upload.name}</div>
            <Badge variant={failed || rejected ? "destructive" : completed ? "default" : "outline"} className="shrink-0">
              {statusLabel(upload)}
            </Badge>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {upload.path || upload.sourceIp}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/80">
            <span>{formatFileSize(upload.size)}</span>
            {durationLabel && <span>{durationLabel}</span>}
            <span>{formatTime(upload.completedAt || upload.updatedAt || upload.createdAt)}</span>
            {upload.status === "uploading" && <span>{percent}%</span>}
          </div>
          {(upload.status === "uploading" || upload.status === "accepted") && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
          )}
          {upload.error && <div className="mt-1 text-xs text-destructive">{upload.error}</div>}
        </div>
        {(onAccept || onReject || showHistoryActions) && (
          <div className="flex shrink-0 items-center gap-1">
            {onAccept && (
              <Button variant="ghost" size="icon-xs" disabled={busy} title="接收" onClick={() => void onAccept()}>
                <Check />
              </Button>
            )}
            {onReject && (
              <Button variant="ghost" size="icon-xs" disabled={busy} title="拒绝" onClick={() => void onReject()}>
                <X />
              </Button>
            )}
            {showHistoryActions && (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy || !upload.path}
                  title={upload.path ? "打开文件夹" : "没有可打开的文件"}
                  onClick={() => void openUploadedFile()}
                >
                  <FolderOpen />
                </Button>
                {onDelete && (
                  <Button variant="ghost" size="icon-xs" disabled={busy} title="删除记录" onClick={() => void onDelete()}>
                    <Trash2 />
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
