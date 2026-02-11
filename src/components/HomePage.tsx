import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Hash, Type, Clock, ChevronRight } from "lucide-react";
import type { HistoryRecord } from "@/types/history";

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

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

interface HomePageProps {
  onNavigate?: (tab: string) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const [stats, setStats] = useState<{ totalDurationMs: number; totalChars: number; totalCount: number } | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

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

  useEffect(() => {
    loadStats();
    loadHistory();
  }, []);

  // 监听 ASR 完成事件，自动刷新统计和历史
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
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 space-y-4">
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

      <Card>
        <CardHeader>
          <CardTitle>识别历史</CardTitle>
          <CardDescription>最近的语音识别记录</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              暂无识别记录
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {recentHistory.map((record, index) => (
                  <div
                    key={index}
                    className="w-full text-left rounded-lg border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate flex-1">
                        {record.outputText}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {history.length > 5 && (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onNavigate?.("history")}
                  >
                    查看更多
                    <ChevronRight className="size-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
