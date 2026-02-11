import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { defaultSettings, type AppSettings } from "@/types/settings";
import {
  defaultPolishSettings,
  builtinPrompts,
  type PolishSettings,
  type PolishPrompt,
  type PolishProvider,
} from "@/types/polish";
import { defaultAsrSettings, type AsrSettings } from "@/types/asr";

interface SettingsStore {
  // ---- 状态 ----
  appSettings: AppSettings;
  asrSettings: AsrSettings;
  polishSettings: PolishSettings;
  loaded: boolean;

  // ---- UI 状态 ----
  autostartWarning: string | null;
  autostartFlash: boolean;
  setAutostartWarning: (source: string | null) => void;
  dismissAutostartWarning: () => void;

  // 更新检查
  updateAvailable: { version: string; url: string } | null;
  checkUpdate: () => Promise<void>;

  // ---- 动作 ----
  loadSettings: () => Promise<void>;

  // appSettings
  updateAppSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

  // asrSettings
  updateAsrSettings: (next: AsrSettings) => void;

  // polishSettings — 粒度方法
  setPolishEnabled: (enabled: boolean) => void;
  setSelectedPromptId: (id: string) => void;
  setSelectedProviderId: (id: string) => void;
  updatePolishPrompts: (prompts: PolishPrompt[]) => void;
  updatePolishProviders: (providers: PolishProvider[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(get: () => SettingsStore) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const { appSettings, asrSettings, polishSettings } = get();
      await invoke("cmd_save_settings", {
        settings: {
          app_settings: appSettings,
          asr_settings: asrSettings,
          polish_settings: polishSettings,
        },
      });
      toast.success("设置已保存");
    } catch (e) {
      console.error("Failed to save:", e);
      toast.error("保存失败");
    }
  }, 500);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  appSettings: defaultSettings,
  asrSettings: defaultAsrSettings,
  polishSettings: defaultPolishSettings,
  loaded: false,

  autostartWarning: null,
  autostartFlash: false,
  setAutostartWarning: (source) => {
    if (source) {
      if (get().autostartWarning) {
        set({ autostartFlash: true });
        setTimeout(() => set({ autostartFlash: false }), 600);
      }
      set({ autostartWarning: source });
    } else {
      set({ autostartWarning: null });
    }
  },
  dismissAutostartWarning: () => set({ autostartWarning: null }),

  updateAvailable: null,
  _updateChecked: false,
  checkUpdate: async () => {
    if (get()._updateChecked) return;
    set({ _updateChecked: true });
    try {
      const result = await invoke<string | null>("cmd_check_update");
      if (result) {
        const tag = result.split("/").pop() || "";
        const version = tag.startsWith("v") ? tag : `v${tag}`;
        set({ updateAvailable: { version, url: result } });
      }
    } catch (e) {
      console.error("[check_update] failed:", e);
    }
  },

  loadSettings: async () => {
    if (get().loaded) return;
    try {
      const result = await invoke<Record<string, unknown>>("cmd_load_settings");
      if (result) {
        set((state) => {
          const next: Partial<SettingsStore> = { loaded: true };

          if (result.app_settings) {
            next.appSettings = { ...state.appSettings, ...(result.app_settings as Partial<AppSettings>) };
          }
          if (result.asr_settings) {
            const loaded = result.asr_settings as Partial<AsrSettings>;
            const mergedProviders = {
              ...state.asrSettings.providers,
              ...(loaded.providers ?? {}),
            };
            next.asrSettings = { ...state.asrSettings, ...loaded, providers: mergedProviders };
          }
          if (result.polish_settings) {
            const loaded = result.polish_settings as Partial<PolishSettings>;
            const merged = { ...state.polishSettings, ...loaded };
            if (merged.prompts) {
              const existingIds = new Set(merged.prompts.map((p) => p.id));
              const missing = builtinPrompts.filter((bp) => !existingIds.has(bp.id));
              if (missing.length > 0) {
                merged.prompts = [...missing, ...merged.prompts];
              }
            }
            next.polishSettings = merged;
          }

          return next;
        });
      } else {
        set({ loaded: true });
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
      set({ loaded: true });
    }
  },

  updateAppSetting: (key, value) => {
    set((state) => ({
      appSettings: { ...state.appSettings, [key]: value },
    }));
    debouncedSave(get);
  },

  updateAsrSettings: (next) => {
    set({ asrSettings: next });
    debouncedSave(get);
  },

  setPolishEnabled: (enabled) => {
    set((state) => ({
      polishSettings: { ...state.polishSettings, enabled },
    }));
    debouncedSave(get);
  },

  setSelectedPromptId: (id) => {
    set((state) => ({
      polishSettings: { ...state.polishSettings, selectedPromptId: id },
    }));
    debouncedSave(get);
  },

  setSelectedProviderId: (id) => {
    set((state) => ({
      polishSettings: { ...state.polishSettings, selectedProviderId: id },
    }));
    debouncedSave(get);
  },

  updatePolishPrompts: (prompts) => {
    set((state) => {
      const next = { ...state.polishSettings, prompts };
      if (state.polishSettings.selectedPromptId && !prompts.find((p) => p.id === state.polishSettings.selectedPromptId)) {
        next.selectedPromptId = "";
        next.enabled = false;
      }
      return { polishSettings: next };
    });
    debouncedSave(get);
  },

  updatePolishProviders: (providers) => {
    set((state) => {
      const next = { ...state.polishSettings, providers };
      if (state.polishSettings.selectedProviderId && !providers.find((p) => p.id === state.polishSettings.selectedProviderId)) {
        next.selectedProviderId = "";
        next.enabled = false;
      }
      return { polishSettings: next };
    });
    debouncedSave(get);
  },
}));
