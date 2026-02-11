import { GeneralHome } from "./general/GeneralHome";
import { HotkeySettings } from "./general/HotkeySettings";
import { DataSettings } from "./general/DataSettings";

export function GeneralSettings() {
  return (
    <div className="space-y-10">
      <GeneralHome />
      <HotkeySettings />
      <DataSettings />
    </div>
  );
}
