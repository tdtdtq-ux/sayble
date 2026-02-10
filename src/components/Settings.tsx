import { useState, useEffect, useCallback, useImperativeHandle, useRef, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Mic, Settings2, Info, ArrowLeft, Sparkles } from "lucide-react";
import { VoiceSettings } from "./VoiceSettings";
import { GeneralSettings } from "./GeneralSettings";
import { PolishSettings } from "./polish/PolishSettings";
import { About } from "./About";
import { AppIcon } from "./AppIcon";
import { defaultSettings, type AppSettings } from "@/types/settings";
import { defaultPolishSettings, builtinPrompts, type PolishSettings as PolishSettingsType } from "@/types/polish";
import { defaultAsrSettings, type AsrSettings } from "@/types/asr";

export interface SettingsHandle {
  showAbout: () => void;
}

interface SettingsProps {
  ref?: Ref<SettingsHandle>;
  onBack?: () => void;
  onAutostartWarning?: (source: string | null) => void;
}

const menuItems = [
  { key: "voice", label: "ASR管理", icon: Mic },
  { key: "polish", label: "LLM管理", icon: Sparkles },
  { key: "general", label: "通用", icon: Settings2 },
  { key: "about", label: "关于", icon: Info },
] as const;

type TabKey = (typeof menuItems)[number]["key"];

export function Settings({ ref, onBack, onAutostartWarning }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [polishSettings, setPolishSettings] = useState<PolishSettingsType>(defaultPolishSettings);
  const [asrSettings, setAsrSettings] = useState<AsrSettings>(defaultAsrSettings);
  const [activeTab, setActiveTab] = useState<TabKey>("voice");

  useImperativeHandle(ref, () => ({
    showAbout: () => setActiveTab("about"),
  }), []);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await invoke<Record<string, unknown>>("cmd_load_settings");
      if (result) {
        if (result.app_settings) {
          setSettings((prev) => ({ ...prev, ...(result.app_settings as Partial<AppSettings>) }));
        }
        if (result.asr_settings) {
          setAsrSettings((prev) => ({ ...prev, ...(result.asr_settings as Partial<AsrSettings>) }));
        }
        if (result.polish_settings) {
          const loaded = result.polish_settings as Partial<PolishSettingsType>;
          setPolishSettings((prev) => {
            const merged = { ...prev, ...loaded };
            // 合并内建 Prompt：将代码中新增的内建模板补充到已有列表中
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
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  };

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const polishSettingsRef = useRef(polishSettings);
  polishSettingsRef.current = polishSettings;
  const asrSettingsRef = useRef(asrSettings);
  asrSettingsRef.current = asrSettings;

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await invoke("cmd_save_settings", {
          settings: {
            app_settings: settingsRef.current,
            asr_settings: asrSettingsRef.current,
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

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      settingsRef.current = next;
      debouncedSave();
      return next;
    });
  }, [debouncedSave]);

  const updateAsrSettings = useCallback((next: AsrSettings) => {
    setAsrSettings(next);
    asrSettingsRef.current = next;
    debouncedSave();
  }, [debouncedSave]);

  const updatePolishSettings = useCallback((next: PolishSettingsType) => {
    setPolishSettings(next);
    polishSettingsRef.current = next;
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
        <nav className="flex-1 px-3 flex flex-col gap-1">
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
        {onBack && (
          <div className="px-4 pb-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-4 shrink-0" />
              返回首页
            </button>
          </div>
        )}
      </div>

      {/* 右侧内容区 */}
      {activeTab === "polish" || activeTab === "voice" ? (
        <div className="flex-1 min-w-0 flex flex-col">
          {activeTab === "polish" && <PolishSettings settings={polishSettings} onChange={updatePolishSettings} />}
          {activeTab === "voice" && <VoiceSettings settings={asrSettings} onUpdate={updateAsrSettings} />}
        </div>
      ) : (
        <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pt-6 pb-6">
          {activeTab === "general" && (
            <GeneralSettings
              settings={settings}
              onUpdate={updateSetting}
              onAutostartWarning={onAutostartWarning}
            />
          )}
          {activeTab === "about" && <About />}
        </div>
      )}
    </div>
  );
}
