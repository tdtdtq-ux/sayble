import { useState, useImperativeHandle, type Ref } from "react";
import { Mic, Settings2, Info, ArrowLeft, Sparkles } from "lucide-react";
import { ShellLayout, type ShellMenuItem } from "./ShellLayout";
import { VoiceSettings } from "./VoiceSettings";
import { GeneralSettings } from "./GeneralSettings";
import { PolishProviderManager } from "./polish/PolishProviderManager";
import { About } from "./About";

export interface SettingsHandle {
  showAbout: () => void;
}

interface SettingsProps {
  ref?: Ref<SettingsHandle>;
  onBack?: () => void;
  initialTab?: string;
}

const menuItems: readonly ShellMenuItem[] = [
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
    <ShellLayout
      menuItems={menuItems}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as TabKey)}
      footer={
        onBack ? (
          <div className="px-4 pb-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-4 shrink-0" />
              返回首页
            </button>
          </div>
        ) : undefined
      }
    >
      {activeTab === "voice" && <VoiceSettings />}
      {activeTab === "polish" && <PolishProviderManager />}
      {activeTab === "general" && <GeneralSettings />}
      {activeTab === "about" && <About />}
    </ShellLayout>
  );
}
