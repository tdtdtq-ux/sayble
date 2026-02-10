import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppIcon } from "./AppIcon";
import { Settings, Hash, Type, Clock } from "lucide-react";

function formatStatsDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

interface HomePageProps {
  onOpenSettings: () => void;
}

export function HomePage({ onOpenSettings }: HomePageProps) {
  const [stats, setStats] = useState<{ totalDurationMs: number; totalChars: number; totalCount: number } | null>(null);

  const loadStats = async () => {
    try {
      const result = await invoke<{ totalDurationMs: number; totalChars: number; totalCount: number }>("cmd_load_stats");
      setStats(result);
    } catch (e) {
      console.error("Failed to load stats:", e);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  // 监听 ASR 完成事件，自动刷新统计
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ event: string | object }>("asr-event", (ev) => {
      if (cancelled) return;
      const { event } = ev.payload;
      if (event === "Finished") {
        loadStats();
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

  return (
    <div className="mx-auto max-w-2xl h-full flex flex-col">
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <AppIcon className="size-6" />
              Sayble
            </h1>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pb-6">
        <Card>
          <CardHeader>
            <CardTitle>使用统计</CardTitle>
            <CardDescription>语音识别累计使用数据</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                <Hash className="size-5 text-muted-foreground" />
                <span className="text-2xl font-bold">{stats?.totalCount ?? 0}</span>
                <span className="text-sm text-muted-foreground">识别次数</span>
              </div>
              <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                <Type className="size-5 text-muted-foreground" />
                <span className="text-2xl font-bold">{stats?.totalChars ?? 0}</span>
                <span className="text-sm text-muted-foreground">识别字数</span>
              </div>
              <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                <Clock className="size-5 text-muted-foreground" />
                <span className="text-2xl font-bold">{formatStatsDuration(stats?.totalDurationMs ?? 0)}</span>
                <span className="text-sm text-muted-foreground">录音时长</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <button
        onClick={onOpenSettings}
        className="fixed left-4 bottom-4 size-10 rounded-full bg-muted/80 hover:bg-muted flex items-center justify-center transition-colors"
      >
        <Settings className="size-5 text-muted-foreground" />
      </button>
    </div>
  );
}
