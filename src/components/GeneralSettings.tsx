import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralHome } from "./general/GeneralHome";
import { HotkeySettings } from "./general/HotkeySettings";
import { DataSettings } from "./general/DataSettings";
import type { AppSettings } from "@/types/settings";

interface GeneralSettingsProps {
  settings: AppSettings;
  onUpdate: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onAutostartWarning?: (source: string | null) => void;
}

export function GeneralSettings({ settings, onUpdate, onAutostartWarning }: GeneralSettingsProps) {
  return (
    <Tabs defaultValue="home">
      <TabsList>
        <TabsTrigger value="home">首页</TabsTrigger>
        <TabsTrigger value="hotkey">快捷键</TabsTrigger>
        <TabsTrigger value="data">数据</TabsTrigger>
      </TabsList>
      <TabsContent value="home">
        <GeneralHome settings={settings} onUpdate={onUpdate} onAutostartWarning={onAutostartWarning} />
      </TabsContent>
      <TabsContent value="hotkey">
        <HotkeySettings settings={settings} onUpdate={onUpdate} />
      </TabsContent>
      <TabsContent value="data">
        <DataSettings />
      </TabsContent>
    </Tabs>
  );
}
