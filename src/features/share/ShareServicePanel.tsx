import { AlertCircle, Copy, ExternalLink, Play, QrCode, Square } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import type { ShareHostCandidate } from "@/types/share";

interface ShareServicePanelProps {
  running: boolean;
  busy: boolean;
  host: string;
  port: number | undefined;
  hosts: ShareHostCandidate[];
  portInput: string;
  qrDataUrl: string;
  shareUrl: string;
  statusMessage: { kind: "success" | "error"; text: string } | null;
  onPortInputChange: (value: string) => void;
  onStartServer: () => void;
  onStopServer: () => void;
  onSelectHost: (address: string) => void;
  onCopyText: (value: string, message: string) => void | Promise<void>;
}

export function ShareServicePanel({
  running,
  busy,
  host,
  port,
  hosts,
  portInput,
  qrDataUrl,
  shareUrl,
  statusMessage,
  onPortInputChange,
  onStartServer,
  onStopServer,
  onSelectHost,
  onCopyText,
}: ShareServicePanelProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col rounded-md border bg-muted/30">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <QrCode className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">扫码</h3>
      </div>
      <Separator />
      {!running && (
        <div className="flex shrink-0 flex-col gap-3 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-port">服务端口</Label>
            <Input
              id="share-port"
              type="number"
              min={1}
              max={65535}
              value={portInput}
              disabled={busy}
              onChange={(event) => onPortInputChange(event.target.value)}
            />
          </div>
          <Button disabled={busy} onClick={onStartServer}>
            <Play data-icon="inline-start" />
            启动服务
          </Button>
          {statusMessage && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="break-all">{statusMessage.text}</span>
            </div>
          )}
        </div>
      )}
      {running && (
        <>
          <div className="flex shrink-0 items-end gap-2 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="text-xs text-muted-foreground">地址</div>
              <Select value={host} disabled={busy || !host} onValueChange={onSelectHost}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择 IP" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {hosts.map((candidate) => (
                      <SelectItem key={candidate.address} value={candidate.address}>
                        {candidate.address}:{port} · {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={onStopServer}>
              <Square data-icon="inline-start" />
              停止
            </Button>
          </div>
          <Separator />
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
            <div className="flex size-48 items-center justify-center rounded-md bg-background p-3 shadow-xs">
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
              <Button variant="outline" size="sm" disabled={!shareUrl} onClick={() => void onCopyText(shareUrl, "链接已复制")}>
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
          </div>
        </>
      )}
    </aside>
  );
}
