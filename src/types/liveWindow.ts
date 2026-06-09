export interface LiveWindowConfig {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

export interface LiveWindowSettings {
  liveWindows: LiveWindowConfig[];
}

export type LiveWindowPresetValue = "3:4" | "9:16" | "16:9" | "custom";

export interface LiveWindowPreset {
  value: LiveWindowPresetValue;
  label: string;
  widthRatio: number;
  heightRatio: number;
}

export const LIVE_WINDOW_MIN_WIDTH = 200;
export const LIVE_WINDOW_MIN_HEIGHT = 200;
export const LIVE_WINDOW_MAX_WIDTH = 3840;
export const LIVE_WINDOW_MAX_HEIGHT = 3840;

export const LIVE_WINDOW_PRESETS: LiveWindowPreset[] = [
  { value: "3:4", label: "3:4", widthRatio: 3, heightRatio: 4 },
  { value: "9:16", label: "9:16", widthRatio: 9, heightRatio: 16 },
  { value: "16:9", label: "16:9", widthRatio: 16, heightRatio: 9 },
  { value: "custom", label: "自定义", widthRatio: 1, heightRatio: 1 },
];

export const defaultLiveWindowSettings: LiveWindowSettings = {
  liveWindows: [],
};

export function getLiveWindowDraft(presetValue: LiveWindowPresetValue, width: number): Pick<LiveWindowConfig, "width" | "height"> {
  const safeWidth = clampDimension(width, LIVE_WINDOW_MIN_WIDTH, LIVE_WINDOW_MAX_WIDTH);
  const preset = LIVE_WINDOW_PRESETS.find((item) => item.value === presetValue);
  if (!preset || preset.value === "custom") {
    return { width: safeWidth, height: safeWidth };
  }

  return {
    width: safeWidth,
    height: clampDimension(Math.round((safeWidth * preset.heightRatio) / preset.widthRatio), LIVE_WINDOW_MIN_HEIGHT, LIVE_WINDOW_MAX_HEIGHT),
  };
}

export function normalizeLiveWindowUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function validateLiveWindow(config: LiveWindowConfig): LiveWindowConfig | null {
  const name = config.name.trim();
  const url = normalizeLiveWindowUrl(config.url);
  const width = Math.round(config.width);
  const height = Math.round(config.height);

  if (!config.id || !name || !url) return null;
  if (!isDimensionInRange(width, LIVE_WINDOW_MIN_WIDTH, LIVE_WINDOW_MAX_WIDTH)) return null;
  if (!isDimensionInRange(height, LIVE_WINDOW_MIN_HEIGHT, LIVE_WINDOW_MAX_HEIGHT)) return null;

  return {
    id: config.id,
    name,
    url,
    width,
    height,
  };
}

function clampDimension(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : min);
  return Math.min(Math.max(rounded, min), max);
}

function isDimensionInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}
