import type { LiveWindowConfig } from "./liveWindow";

export interface AudioDevice {
  name: string;
  is_default: boolean;
}

export interface AppSettings {
  outputMode: "Clipboard" | "SimulateKeyboard";
  microphoneDevice: string;
  autoStart: boolean;
  autoOutput: boolean;
  toggleHotkey: string;
  deviceId: string;
  liveWindows: LiveWindowConfig[];
}

export const defaultSettings: AppSettings = {
  outputMode: "Clipboard",
  microphoneDevice: "",
  autoStart: false,
  autoOutput: true,
  toggleHotkey: "右Ctrl",
  deviceId: "",
  liveWindows: [],
};
