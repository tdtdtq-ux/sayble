import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Check } from "lucide-react";
import { builtinPromptIds, type PolishPrompt } from "@/types/polish";
import { useSettingsStore } from "@/stores/useSettingsStore";

export function PersonaPage() {
  const { polishSettings, setPolishEnabled, setSelectedPromptId, updatePolishPrompts } = useSettingsStore();
  const { prompts, selectedPromptId, enabled } = polishSettings;

  const [activeId, setActiveId] = useState<string>(
    prompts[0]?.id ?? ""
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const activePrompt = prompts.find((p) => p.id === activeId);
  const isBuiltin = (id: string) => builtinPromptIds.has(id);

  const updatePrompt = (id: string, data: Partial<Omit<PolishPrompt, "id">>) => {
    updatePolishPrompts(prompts.map((p) => (p.id === id ? { ...p, ...data } : p)));
  };

  const startEditName = () => {
    if (!activePrompt) return;
    setDraftName(activePrompt.name);
    setEditingName(true);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const commitName = () => {
    if (activePrompt && draftName.trim() && draftName.trim() !== activePrompt.name) {
      updatePrompt(activePrompt.id, { name: draftName.trim() });
    }
    setEditingName(false);
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  const startEditContent = () => {
    if (!activePrompt) return;
    setDraftContent(activePrompt.content);
    setEditingContent(true);
    requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.focus();
        autoResize(contentRef.current);
      }
    });
  };

  const commitContent = () => {
    if (activePrompt && draftContent.trim() && draftContent.trim() !== activePrompt.content) {
      updatePrompt(activePrompt.id, { content: draftContent.trim() });
    }
    setEditingContent(false);
  };

  const handleCreate = () => {
    const newPrompt = {
      id: crypto.randomUUID(),
      name: "新人设",
      content: "请将以下口语化的文字转换为书面语，只输出润色后的文字。",
    };
    updatePolishPrompts([...prompts, newPrompt]);
    setActiveId(newPrompt.id);
    setEditingName(false);
    setEditingContent(false);
    requestAnimationFrame(() => {
      setDraftName(newPrompt.name);
      setEditingName(true);
      requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      });
    });
  };

  const handleDelete = (id: string) => {
    const idx = prompts.findIndex((p) => p.id === id);
    const next = prompts.filter((p) => p.id !== id);
    updatePolishPrompts(next);
    setDeletingId(null);
    if (activeId === id && next.length > 0) {
      const newIdx = Math.min(idx, next.length - 1);
      setActiveId(next[newIdx].id);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">设置您的人设</h2>
          <Switch checked={enabled} onCheckedChange={setPolishEnabled} />
        </div>
        <Button variant="outline" size="sm" onClick={handleCreate}>
          <Plus className="size-4 mr-1" />
          新建
        </Button>
      </div>

      {/* 下方左右分栏 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧列表 */}
        <div className="w-48 shrink-0 overflow-y-auto custom-scrollbar space-y-1.5 pb-4 pl-6">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              onClick={() => setActiveId(prompt.id)}
              className={`w-full text-left px-3 py-2 text-sm rounded-md border transition-colors ${
                activeId === prompt.id
                  ? "border-primary bg-muted text-foreground"
                  : "border-border hover:border-primary/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="block truncate font-medium">
                {prompt.name}
              </span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">
                {isBuiltin(prompt.id) ? "内置" : "自定义"}
                {prompt.id === selectedPromptId && (
                  <span className="bg-foreground text-background rounded px-1 py-0.5 ml-1.5">使用中</span>
                )}
              </span>
            </button>
          ))}
        </div>

        {/* 右侧详情 */}
        {activePrompt ? (
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pb-6 space-y-3">
            {/* 名称 + 内置标记 + 操作按钮 */}
            <div className="flex items-center gap-2">
              {editingName ? (
                <Input
                  ref={nameInputRef}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="text-lg font-semibold h-auto py-0.5 px-1.5 w-auto max-w-xs"
                />
              ) : (
                <h2
                  className="text-lg font-semibold cursor-text hover:bg-muted/50 rounded px-1.5 py-0.5 transition-colors"
                  onClick={startEditName}
                >
                  {activePrompt.name}
                </h2>
              )}
              {isBuiltin(activePrompt.id) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                  内置
                </Badge>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {activePrompt.id === selectedPromptId ? (
                  <Button variant="outline" size="sm" disabled>
                    <Check className="size-4 mr-1" />
                    使用中
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setSelectedPromptId(activePrompt.id)}
                  >
                    使用
                  </Button>
                )}
                {!isBuiltin(activePrompt.id) &&
                  (deletingId === activePrompt.id ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(activePrompt.id)}
                      onBlur={() => setDeletingId(null)}
                    >
                      确认删除?
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeletingId(activePrompt.id)}
                    >
                      <Trash2 className="size-3.5 mr-1" />
                      删除
                    </Button>
                  ))}
              </div>
            </div>

            {/* Prompt 内容 */}
            {editingContent ? (
              <textarea
                ref={contentRef}
                value={draftContent}
                onChange={(e) => {
                  setDraftContent(e.target.value);
                  autoResize(e.target);
                }}
                onBlur={commitContent}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingContent(false);
                }}
                className="w-full text-sm leading-relaxed bg-muted/50 rounded-md p-4 border border-ring outline-none resize-none overflow-hidden"
              />
            ) : (
              <p
                className="text-sm whitespace-pre-wrap leading-relaxed bg-muted/50 rounded-md p-4 cursor-text hover:border hover:border-border transition-colors border border-transparent"
                onClick={startEditContent}
              >
                {activePrompt.content}
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            暂无人设，点击右上角新建
          </div>
        )}
      </div>
    </div>
  );
}
