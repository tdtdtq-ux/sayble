import { useState, useImperativeHandle, type Ref } from "react";
import { Mic, Settings2, Info, ArrowLeft, Sparkles } from "lucide-react";
import { VoiceSettings } from "./VoiceSettings";
import { GeneralSettings } from "./GeneralSettings";
import { PolishProviderManager } from "./polish/PolishProviderManager";
import { About } from "./About";
import { AppIcon } from "./AppIcon";

export interface SettingsHandle {
  showAbout: () => void;
}

interface SettingsProps {
  ref?: Ref<SettingsHandle>;
  onBack?: () => void;
  initialTab?: string;
}

const menuItems = [
  { key: "voice", label: "识别引擎", icon: Mic },
  { key: "polish", label: "润色引擎", icon: Sparkles },
  { key: "general", label: "通用", icon: Settings2 },
  { key: "about", label: "关于", icon: Info },
] as const;

type TabKey = (typeof menuItems)[number]["key"];

export function Settings({ ref, onBack, initialTab }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (initialTab && menuItems.some((m) => m.key === initialTab)) {
      return initialTab as TabKey;
    }
    return "voice";
  });

  useImperativeHandle(ref, () => ({
    showAbout: () => setActiveTab("about"),
  }), []);

  return (
    <div className="h-full flex">
      {/* 左侧菜单 */}
      <div className="w-56 shrink-0 bg-muted flex flex-col">
        <div className="px-4 pt-6 pb-4">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <AppIcon className="size-9" />
            <span className="font-brand">Sayble</span>
          </h1>
        </div>
        <nav className="flex-1 px-3 flex flex-col gap-1">
          {menuItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left ${
                activeTab === key
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
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
              className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground transition-colors"
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
          {activeTab === "polish" && <PolishProviderManager />}
          {activeTab === "voice" && <VoiceSettings />}
        </div>
      ) : (
        <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-6 pt-6 pb-6">
          {activeTab === "general" && <GeneralSettings />}
          {activeTab === "about" && <About />}
        </div>
      )}
    </div>
  );
}
