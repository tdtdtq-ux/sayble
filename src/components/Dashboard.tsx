import { useState } from "react";
import { Settings, Home, UserRound } from "lucide-react";
import { AppIcon } from "./AppIcon";
import { HomePage } from "./HomePage";
import { PersonaPage } from "./PersonaPage";

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
        {activeTab === "persona" && <PersonaPage />}
      </div>
    </div>
  );
}
