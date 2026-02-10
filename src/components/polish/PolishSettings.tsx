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

  const handleSelectProvider = (id: string) => {
    onChange({ ...settings, selectedProviderId: id });
  };

  return (
    <PolishProviderManager
      providers={settings.providers}
      onChange={handleProvidersChange}
      selectedProviderId={settings.selectedProviderId}
      onSelectProvider={handleSelectProvider}
    />
  );
}
