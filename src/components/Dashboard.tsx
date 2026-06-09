import { useState } from "react";
import { Settings, Home, UserRound, History, Cable, Share2, Mic2, MonitorPlay } from "lucide-react";
import { ShellLayout, type ShellMenuItem } from "./ShellLayout";
import { HomePage } from "./HomePage";
import { RecorderPage } from "./RecorderPage";
import { PersonaPage } from "./PersonaPage";
import { HistoryPage } from "./HistoryPage";
import { TunnelPage } from "@/features/tunnels/TunnelPage";
import { SharePage } from "@/features/share/SharePage";
import { LiveWindowSettings } from "./LiveWindowSettings";

const menuItems: readonly ShellMenuItem[] = [
  { key: "home", label: "首页", icon: Home },
  { key: "recorder", label: "录音", icon: Mic2 },
  { key: "history", label: "历史", icon: History },
  { key: "persona", label: "人设", icon: UserRound },
  { key: "live", label: "直播", icon: MonitorPlay },
  { key: "tunnels", label: "隧道", icon: Cable },
  { key: "share", label: "共享", icon: Share2 },
] as const;

type TabKey = (typeof menuItems)[number]["key"];

interface DashboardProps {
  onOpenSettings: (tab?: string) => void;
}

export function Dashboard({ onOpenSettings }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("home");

  return (
    <ShellLayout
      menuItems={menuItems}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as TabKey)}
      footer={
        <div className="px-4 pb-4">
          <button
            onClick={() => onOpenSettings()}
            className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground transition-colors"
          >
            <Settings className="size-4 shrink-0" />
            设置
          </button>
        </div>
      }
    >
      {activeTab === "home" && <HomePage onNavigate={(tab) => setActiveTab(tab as TabKey)} onOpenSettings={onOpenSettings} />}
      {activeTab === "recorder" && <RecorderPage />}
      {activeTab === "history" && <HistoryPage />}
      {activeTab === "persona" && <PersonaPage />}
      {activeTab === "live" && <LiveWindowSettings />}
      {activeTab === "tunnels" && <TunnelPage />}
      {activeTab === "share" && <SharePage />}
    </ShellLayout>
  );
}
