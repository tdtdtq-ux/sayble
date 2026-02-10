import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralHome } from "./general/GeneralHome";
import { HotkeySettings } from "./general/HotkeySettings";
import { DataSettings } from "./general/DataSettings";

export function GeneralSettings() {
  return (
    <Tabs defaultValue="home">
      <TabsList>
        <TabsTrigger value="home">首页</TabsTrigger>
        <TabsTrigger value="hotkey">快捷键</TabsTrigger>
        <TabsTrigger value="data">数据</TabsTrigger>
      </TabsList>
      <TabsContent value="home">
        <GeneralHome />
      </TabsContent>
      <TabsContent value="hotkey">
        <HotkeySettings />
      </TabsContent>
      <TabsContent value="data">
        <DataSettings />
      </TabsContent>
    </Tabs>
  );
}
