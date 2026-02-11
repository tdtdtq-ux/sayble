import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { AppIcon } from "./AppIcon";

export interface ShellMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface ShellLayoutProps {
  menuItems: readonly ShellMenuItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function ShellLayout({ menuItems, activeTab, onTabChange, footer, children }: ShellLayoutProps) {
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
              onClick={() => onTabChange(key)}
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
        {footer}
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>
    </div>
  );
}
