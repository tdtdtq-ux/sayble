import type { DragEvent } from "react";
import { Copy, FileDown, FolderOpen, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { SharedFile } from "@/types/share";
import { downloadUrl, formatFileSize, formatTime } from "./shareUtils";

interface LocalShareTabProps {
  files: SharedFile[];
  loading: boolean;
  busy: boolean;
  dragActive: boolean;
  shareUrl: string;
  totalSize: number;
  onPreventDrop: (event: DragEvent<HTMLDivElement>) => void;
  onClearFiles: () => void;
  onCopyText: (value: string, message: string) => void | Promise<void>;
  onRemoveFile: (file: SharedFile) => void | Promise<void>;
}

export function LocalShareTab({
  files,
  loading,
  busy,
  dragActive,
  shareUrl,
  totalSize,
  onPreventDrop,
  onClearFiles,
  onCopyText,
  onRemoveFile,
}: LocalShareTabProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="relative flex min-h-0 flex-1 flex-col rounded-md border"
        onDragEnter={onPreventDrop}
        onDragOver={onPreventDrop}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border border-dashed border-primary bg-background/90 shadow-sm">
            <div className="flex items-center gap-3 rounded-md bg-background px-4 py-3 shadow-xs">
              <Upload className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">放在这里即可共享</span>
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">共享文件</h3>
            <span className="text-xs text-muted-foreground">
              {files.length} 个 · {formatFileSize(totalSize)}
            </span>
          </div>
          <Button variant="ghost" size="xs" disabled={busy || files.length === 0} onClick={onClearFiles}>
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
                        onClick={() => void onCopyText(downloadUrl(shareUrl, file.id), "下载链接已复制")}
                      >
                        <Copy />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={busy}
                        title="移出共享"
                        onClick={() => void onRemoveFile(file)}
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
  );
}
