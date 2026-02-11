import { GeneralHome } from "./general/GeneralHome";
import { DataSettings } from "./general/DataSettings";

export function GeneralSettings() {
  return (
    <div className="space-y-10 px-6 py-3">
      <GeneralHome />
      <DataSettings />
    </div>
  );
}
