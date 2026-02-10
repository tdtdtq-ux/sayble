import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PolishHome } from "./PolishHome";
import { PolishProviderManager } from "./PolishProviderManager";
import { type PolishSettings as PolishSettingsType, type PolishProvider } from "@/types/polish";

interface PolishSettingsProps {
  settings: PolishSettingsType;
  onChange: (next: PolishSettingsType) => void;
}

export function PolishSettings({ settings, onChange }: PolishSettingsProps) {
  const handleProvidersChange = (providers: PolishProvider[]) => {
    const next = { ...settings, providers };
    if (settings.selectedProviderId && !providers.find((p) => p.id === settings.selectedProviderId)) {
      next.selectedProviderId = "";
      next.enabled = false;
    }
    onChange(next);
  };

  return (
    <Tabs defaultValue="home">
      <TabsList>
        <TabsTrigger value="home">首页</TabsTrigger>
        <TabsTrigger value="providers">供应商</TabsTrigger>
      </TabsList>
      <TabsContent value="home">
        <PolishHome settings={settings} onChange={onChange} />
      </TabsContent>
      <TabsContent value="providers">
        <PolishProviderManager providers={settings.providers} onChange={handleProvidersChange} selectedProviderId={settings.selectedProviderId} />
      </TabsContent>
    </Tabs>
  );
}
