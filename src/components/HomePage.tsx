import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronRight, X, Pencil, Mic, Sparkles, UserRound, Hash, Type, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { builtinAsrProviders } from "@/types/asr";
import type { HistoryRecord } from "@/types/history";

function formatStatsDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

interface HomePageProps {
  onNavigate?: (tab: string) => void;
  onOpenSettings?: (tab?: string) => void;
}

export function HomePage({ onNavigate, onOpenSettings }: HomePageProps) {
  const [stats, setStats] = useState<{ totalDurationMs: number; totalChars: number; totalCount: number } | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const asrSettings = useSettingsStore((s) => s.asrSettings);
  const polishSettings = useSettingsStore((s) => s.polishSettings);

  // 当前 ASR 供应商名称
  const asrProviderName = builtinAsrProviders.find((p) => p.type === asrSettings.selectedProvider)?.name ?? "未配置";
  const asrConfig = asrSettings.providers[asrSettings.selectedProvider];
  const asrConfigured = asrConfig?.appId && asrConfig?.accessKey;

  // 当前人设名称
  const selectedPrompt = polishSettings.prompts.find((p) => p.id === polishSettings.selectedPromptId);

  // 当前润色引擎名称
  const selectedPolishProvider = polishSettings.providers.find((p) => p.id === polishSettings.selectedProviderId);

  const loadStats = async () => {
    try {
      const result = await invoke<{ totalDurationMs: number; totalChars: number; totalCount: number }>("cmd_load_stats");
      setStats(result);
    } catch (e) {
      console.error("Failed to load stats:", e);
    }
  };

  const loadHistory = async () => {
    try {
      const result = await invoke<HistoryRecord[]>("cmd_load_history");
      setHistory(result);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    try {
      await invoke("cmd_remove_history", { timestamp: pendingRemove });
      setHistory((prev) => prev.filter((r) => r.timestamp !== pendingRemove));
    } catch (err) {
      console.error("Failed to remove history:", err);
    }
    setPendingRemove(null);
  };

  useEffect(() => {
    loadStats();
    loadHistory();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ event: string | object }>("asr-event", (ev) => {
      if (cancelled) return;
      const { event } = ev.payload;
      if (event === "Finished") {
        loadStats();
        loadHistory();
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
  }, []);

  const recentHistory = history.slice(0, 5);

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
        {/* 统计数字 */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-4 py-3.5">
            <div className="size-9 rounded-md bg-background flex items-center justify-center shrink-0">
              <Hash className="size-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-2xl font-bold font-display-num tracking-tight leading-none">
                {stats?.totalCount ?? 0}
              </div>
              <div className="text-xs text-muted-foreground mt-1">输入次数</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-4 py-3.5">
            <div className="size-9 rounded-md bg-background flex items-center justify-center shrink-0">
              <Type className="size-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-2xl font-bold font-display-num tracking-tight leading-none">
                {stats?.totalChars ?? 0}
              </div>
              <div className="text-xs text-muted-foreground mt-1">输入字数</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-4 py-3.5">
            <div className="size-9 rounded-md bg-background flex items-center justify-center shrink-0">
              <Clock className="size-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-2xl font-bold font-display-num tracking-tight leading-none">
                {formatStatsDuration(stats?.totalDurationMs ?? 0)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">输入时长</div>
            </div>
          </div>
        </div>

        {/* 当前配置 */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <button
            className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-muted/30 transition-colors group"
            onClick={() => onOpenSettings?.("voice")}
          >
            <div className="size-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
              <Mic className="size-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {asrConfigured ? asrProviderName : <span className="text-muted-foreground">未配置</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">识别引擎</div>
            </div>
            <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
          <button
            className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-muted/30 transition-colors group"
            onClick={() => onOpenSettings?.("polish")}
          >
            <div className="size-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
              <Sparkles className="size-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {polishSettings.enabled && selectedPolishProvider
                  ? selectedPolishProvider.name
                  : <span className="text-muted-foreground">未启用</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">润色引擎</div>
            </div>
            <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
          <button
            className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-muted/30 transition-colors group"
            onClick={() => onNavigate?.("persona")}
          >
            <div className="size-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
              <UserRound className="size-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {polishSettings.enabled && selectedPrompt
                  ? selectedPrompt.name
                  : <span className="text-muted-foreground">未启用</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">润色人设</div>
            </div>
            <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        </div>

        {/* 最近记录 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground">最近记录</h2>
            {history.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto py-0.5 px-1.5 text-xs text-muted-foreground"
                onClick={() => onNavigate?.("history")}
              >
                查看更多
                <ChevronRight className="size-3 ml-0.5" />
              </Button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              暂无识别记录
            </div>
          ) : (
            <div className="space-y-0.5">
              {recentHistory.map((record, index) => (
                <div
                  key={index}
                  className="rounded-md px-2.5 py-2.5 hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm break-all">
                        {record.outputText}
                      </div>
                      <div className="text-[11px] text-muted-foreground/60 font-display-num mt-1">
                        {formatTimestamp(record.timestamp)}
                      </div>
                    </div>
                    <button
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive mt-0.5"
                      onClick={() => setPendingRemove(record.timestamp)}
                      title="删除"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <Dialog open={pendingRemove !== null} onOpenChange={(open) => { if (!open) setPendingRemove(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除这条识别记录吗？
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmRemove}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
