import { useState, useEffect, useCallback, useImperativeHandle, useRef, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Mic, Settings2, Info, ArrowLeft, Sparkles } from "lucide-react";
import { VoiceSettings } from "./VoiceSettings";
import { GeneralSettings } from "./GeneralSettings";
import { PolishSettings } from "./polish/PolishSettings";
import { About } from "./About";
import { defaultSettings, type AppSettings } from "@/types/settings";
import { defaultPolishSettings, type PolishSettings as PolishSettingsType } from "@/types/polish";

export interface SettingsHandle {
  showAbout: () => void;
}

interface SettingsProps {
  ref?: Ref<SettingsHandle>;
  onBack?: () => void;
  onAutostartWarning?: (source: string | null) => void;
}

const menuItems = [
  { key: "voice", label: "ASR识别", icon: Mic },
  { key: "polish", label: "LLM润色", icon: Sparkles },
  { key: "general", label: "通用", icon: Settings2 },
  { key: "about", label: "关于", icon: Info },
] as const;

type TabKey = (typeof menuItems)[number]["key"];

export function Settings({ ref, onBack, onAutostartWarning }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [polishSettings, setPolishSettings] = useState<PolishSettingsType>(defaultPolishSettings);
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
        if (result.polish_settings) {
          setPolishSettings((prev) => ({ ...prev, ...(result.polish_settings as Partial<PolishSettingsType>) }));
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

  const updatePolishSettings = useCallback((next: PolishSettingsType) => {
    setPolishSettings(next);
    polishSettingsRef.current = next;
    debouncedSave();
  }, [debouncedSave]);

  return (
    <div className="h-full flex">
      {/* 左侧菜单 */}
      <nav className="shrink-0 w-36 border-r px-3 pt-6 pb-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-3 pb-4">
          {onBack && (
            <button
              onClick={onBack}
              className="size-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <h1 className="text-lg font-bold tracking-tight">设置</h1>
        </div>
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

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pt-6 pb-6">
          {activeTab === "voice" && <VoiceSettings settings={settings} onUpdate={updateSetting} />}
          {activeTab === "polish" && <PolishSettings settings={polishSettings} onChange={updatePolishSettings} />}
          {activeTab === "general" && (
            <GeneralSettings
              settings={settings}
              onUpdate={updateSetting}
              onAutostartWarning={onAutostartWarning}
            />
          )}
          {activeTab === "about" && <About />}
        </div>
    </div>
  );
}
