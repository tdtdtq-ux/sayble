import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Hash, Type, Clock, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
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

function formatTimestamp(ts: string, full = false): string {
  const date = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  if (full) {
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  }
  return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

const PAGE_SIZE = 20;

export function HomePage() {
  const [stats, setStats] = useState<{ totalDurationMs: number; totalChars: number; totalCount: number } | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<HistoryRecord | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
      setPage(0);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  };

  const clearHistory = async () => {
    try {
      await invoke("cmd_clear_history");
      setHistory([]);
      setPage(0);
      setShowClearConfirm(false);
    } catch (e) {
      console.error("Failed to clear history:", e);
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

  const totalPages = Math.ceil(history.length / PAGE_SIZE);
  const pagedHistory = history.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <>
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
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>识别历史</CardTitle>
                <CardDescription>最近的语音识别记录</CardDescription>
              </div>
              {history.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowClearConfirm(true)}
                >
                  <Trash2 className="size-4 mr-1" />
                  清空
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                暂无识别记录
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {pagedHistory.map((record, index) => (
                    <button
                      key={`${page}-${index}`}
                      className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedRecord(record)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm truncate flex-1">
                          {record.outputText}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatTimestamp(record.timestamp)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage(p => p - 1)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(p => p + 1)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 详情弹窗 */}
      <Dialog open={selectedRecord !== null} onOpenChange={(open) => { if (!open) setSelectedRecord(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>识别详情</DialogTitle>
            <DialogDescription>
              {selectedRecord && formatTimestamp(selectedRecord.timestamp, true)}
            </DialogDescription>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary">识别原文</Badge>
                </div>
                <div className="text-sm rounded-lg border p-3 bg-muted/30 whitespace-pre-wrap break-all">
                  {selectedRecord.asrText}
                </div>
              </div>
              {selectedRecord.polishedText !== null && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary">润色结果</Badge>
                  </div>
                  <div className="text-sm rounded-lg border p-3 bg-muted/30 whitespace-pre-wrap break-all">
                    {selectedRecord.polishedText}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 清空确认弹窗 */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认清空</DialogTitle>
            <DialogDescription>
              确定要清空所有识别历史记录吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={clearHistory}>
              清空
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
