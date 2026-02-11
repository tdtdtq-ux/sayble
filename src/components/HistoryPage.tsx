import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trash2, X } from "lucide-react";
import type { HistoryRecord } from "@/types/history";

function formatTime(ts: string): string {
  const date = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

function formatFullTimestamp(ts: string): string {
  const date = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function formatDateLabel(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isToday) return "今天";
  if (isYesterday) return "昨天";

  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return `${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 按日期分组，返回 [日期标签, 记录数组][] */
function groupByDate(records: HistoryRecord[]): [string, HistoryRecord[]][] {
  const groups: Map<string, HistoryRecord[]> = new Map();
  for (const record of records) {
    const date = new Date(record.timestamp);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(record);
  }
  // 转为 [label, records][]，用第一条记录的日期作为 label
  const result: [string, HistoryRecord[]][] = [];
  for (const [, records] of groups) {
    result.push([formatDateLabel(records[0].timestamp), records]);
  }
  return result;
}

export function HistoryPage() {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<HistoryRecord | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      const result = await invoke<HistoryRecord[]>("cmd_load_history");
      setHistory(result);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  };

  const clearHistory = async () => {
    try {
      await invoke("cmd_clear_history");
      setHistory([]);
      setShowClearConfirm(false);
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  };

  const removeHistory = async (timestamp: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingRemove(timestamp);
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
    loadHistory();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ event: string | object }>("asr-event", (ev) => {
      if (cancelled) return;
      const { event } = ev.payload;
      if (event === "Finished") {
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

  const grouped = groupByDate(history);

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-medium text-muted-foreground">
            共 {history.length} 条记录
          </h2>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0.5 px-1.5 text-xs text-muted-foreground"
              onClick={() => setShowClearConfirm(true)}
            >
              <Trash2 className="size-3 mr-1" />
              清空
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="text-sm text-muted-foreground py-16 text-center">
            暂无识别记录
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([dateLabel, records]) => (
              <div key={dateLabel} className="relative">
                {/* 日期标签 */}
                <div className="text-xs font-medium text-muted-foreground mb-2 pl-5">
                  {dateLabel}
                </div>
                {/* 时间轴 + 记录列表 */}
                <div className="relative pl-5">
                  {/* 竖线 */}
                  <div className="absolute left-[3px] top-1 bottom-1 w-px bg-border" />
                  <div className="space-y-0.5">
                    {records.map((record, index) => (
                      <div
                        key={`${dateLabel}-${index}`}
                        className="w-full text-left rounded-md px-2.5 py-2.5 hover:bg-muted/50 transition-colors relative group cursor-pointer"
                        onClick={() => setSelectedRecord(record)}
                      >
                        {/* 时间轴圆点 */}
                        <div className="absolute left-[-17px] top-[15px] size-1.5 rounded-full bg-border shrink-0" />
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm break-all">
                              {record.outputText}
                            </div>
                            <div className="text-[11px] text-muted-foreground/60 font-display-num mt-1">
                              {formatTime(record.timestamp)}
                            </div>
                          </div>
                          <button
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive mt-0.5"
                            onClick={(e) => removeHistory(record.timestamp, e)}
                            title="删除"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 详情弹窗 */}
      <Dialog open={selectedRecord !== null} onOpenChange={(open) => { if (!open) setSelectedRecord(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>识别详情</DialogTitle>
            <DialogDescription>
              {selectedRecord && formatFullTimestamp(selectedRecord.timestamp)}
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
