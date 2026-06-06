import { Clipboard, Copy, Send, Smartphone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ShareContentItem } from "@/types/share";
import { formatTime } from "./shareUtils";

interface ContentTransferTabProps {
  contents: ShareContentItem[];
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCopyText: (value: string, message: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onClear: () => void;
}

export function ContentTransferTab({
  contents,
  draft,
  busy,
  onDraftChange,
  onSend,
  onCopyText,
  onRemove,
  onClear,
}: ContentTransferTabProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Send className="size-4 text-muted-foreground" />
          <div className="text-sm font-medium">发送给手机</div>
        </div>
        <textarea
          className="min-h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={draft}
          maxLength={256 * 1024}
          placeholder="输入内容"
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">{draft.length} 字符</div>
          <Button size="sm" disabled={busy || draft.trim().length === 0} onClick={onSend}>
            <Send data-icon="inline-start" />
            发送
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-md border">
        <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Clipboard className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">内容记录</h3>
            <span className="text-xs text-muted-foreground">{contents.length} 条</span>
          </div>
          <Button variant="ghost" size="xs" disabled={busy || contents.length === 0} onClick={onClear}>
            清空
          </Button>
        </div>
        <Separator />
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-3">
          {contents.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无互传内容</div>
          ) : (
            <div className="flex flex-col gap-2">
              {contents.map((item) => (
                <div key={item.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex items-start gap-3">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={item.direction === "mobileToPc" ? "default" : "outline"}>
                          {item.direction === "mobileToPc" ? "来自手机" : "发给手机"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(item.createdAt)}
                          {item.sourceIp ? ` · ${item.sourceIp}` : ""}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-sm leading-6">{item.text}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="复制"
                        onClick={() => void onCopyText(item.text, "内容已复制")}
                      >
                        <Copy />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={busy}
                        title="删除"
                        onClick={() => void onRemove(item.id)}
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
