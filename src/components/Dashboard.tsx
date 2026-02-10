import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Settings, Home, UserRound } from "lucide-react";
import { AppIcon } from "./AppIcon";
import { HomePage } from "./HomePage";
import { PersonaPage } from "./PersonaPage";
import { defaultPolishSettings, builtinPrompts, type PolishSettings as PolishSettingsType, type PolishPrompt } from "@/types/polish";

const menuItems = [
  { key: "home", label: "首页", icon: Home },
  { key: "persona", label: "人设", icon: UserRound },
] as const;

type TabKey = (typeof menuItems)[number]["key"];

interface DashboardProps {
  onOpenSettings: () => void;
}

export function Dashboard({ onOpenSettings }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [polishSettings, setPolishSettings] = useState<PolishSettingsType>(defaultPolishSettings);

  useEffect(() => {
    loadPolishSettings();
  }, []);

  const loadPolishSettings = async () => {
    try {
      const result = await invoke<Record<string, unknown>>("cmd_load_settings");
      if (result?.polish_settings) {
        const loaded = result.polish_settings as Partial<PolishSettingsType>;
        setPolishSettings((prev) => {
          const merged = { ...prev, ...loaded };
          if (merged.prompts) {
            const existingIds = new Set(merged.prompts.map((p) => p.id));
            const missing = builtinPrompts.filter((bp) => !existingIds.has(bp.id));
            if (missing.length > 0) {
              merged.prompts = [...missing, ...merged.prompts];
            }
          }
          return merged;
        });
      }
    } catch (e) {
      console.error("Failed to load polish settings:", e);
    }
  };

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polishSettingsRef = useRef(polishSettings);
  polishSettingsRef.current = polishSettings;

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        // 全量读取最新 settings，只覆盖 polish_settings
        const current = await invoke<Record<string, unknown>>("cmd_load_settings");
        await invoke("cmd_save_settings", {
          settings: {
            ...current,
            polish_settings: polishSettingsRef.current,
          },
        });
        toast.success("设置已保存");
      } catch (e) {
        console.error("Failed to save:", e);
        toast.error("保存失败");
      }
    }, 500);
  }, []);

  const handlePromptsChange = useCallback((prompts: PolishPrompt[]) => {
    setPolishSettings((prev) => {
      const next = { ...prev, prompts };
      if (prev.selectedPromptId && !prompts.find((p) => p.id === prev.selectedPromptId)) {
        next.selectedPromptId = "";
        next.enabled = false;
      }
      polishSettingsRef.current = next;
      return next;
    });
    debouncedSave();
  }, [debouncedSave]);

  const handleSelectPrompt = useCallback((id: string) => {
    setPolishSettings((prev) => {
      const next = { ...prev, selectedPromptId: id };
      polishSettingsRef.current = next;
      return next;
    });
    debouncedSave();
  }, [debouncedSave]);

  const handleEnabledChange = useCallback((enabled: boolean) => {
    setPolishSettings((prev) => {
      const next = { ...prev, enabled };
      polishSettingsRef.current = next;
      return next;
    });
    debouncedSave();
  }, [debouncedSave]);

  return (
    <div className="h-full flex">
      {/* 左侧菜单 */}
      <div className="w-56 shrink-0 border-r flex flex-col">
        <div className="px-4 pt-6 pb-4">
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <AppIcon className="size-5" />
            Sayble
          </h1>
        </div>
        <nav className="flex-1 flex flex-col gap-1 px-3">
          {menuItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left ${
                activeTab === key
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>
        <div className="px-4 pb-4">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <Settings className="size-4 shrink-0" />
            设置
          </button>
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {activeTab === "home" && <HomePage />}
        {activeTab === "persona" && (
          <PersonaPage
            prompts={polishSettings.prompts}
            onChange={handlePromptsChange}
            selectedPromptId={polishSettings.selectedPromptId}
            onSelectPrompt={handleSelectPrompt}
            enabled={polishSettings.enabled}
            onEnabledChange={handleEnabledChange}
          />
        )}
      </div>
    </div>
  );
}
