import { describe, expect, it } from "vitest";
import {
  LIVE_WINDOW_PRESETS,
  defaultLiveWindowSettings,
  getLiveWindowDraft,
  normalizeLiveWindowUrl,
  validateLiveWindow,
} from "../liveWindow";

describe("live window settings", () => {
  it("starts without saved live windows", () => {
    expect(defaultLiveWindowSettings.liveWindows).toEqual([]);
  });

  it("creates a 3:4 draft from width", () => {
    const draft = getLiveWindowDraft("3:4", 900);

    expect(draft.width).toBe(900);
    expect(draft.height).toBe(1200);
    expect(LIVE_WINDOW_PRESETS.map((preset) => preset.value)).toContain("3:4");
  });

  it("normalizes URLs without a scheme to https", () => {
    expect(normalizeLiveWindowUrl("live.example.com/dashboard")).toBe("https://live.example.com/dashboard");
  });

  it("keeps supported URLs that already include a scheme", () => {
    expect(normalizeLiveWindowUrl("http://localhost:1420")).toBe("http://localhost:1420/");
    expect(normalizeLiveWindowUrl("https://example.com")).toBe("https://example.com/");
  });

  it("rejects incomplete live window configs", () => {
    expect(validateLiveWindow({ id: "1", name: "", url: "https://example.com", width: 900, height: 1200 })).toBeNull();
    expect(validateLiveWindow({ id: "1", name: "直播后台", url: "", width: 900, height: 1200 })).toBeNull();
    expect(validateLiveWindow({ id: "1", name: "直播后台", url: "https://example.com", width: 199, height: 1200 })).toBeNull();
  });

  it("returns a trimmed and normalized valid config", () => {
    expect(validateLiveWindow({
      id: "1",
      name: "  直播后台  ",
      url: "live.example.com/dashboard",
      width: 900,
      height: 1200,
      cameraDeviceId: "  camera-1  ",
    })).toEqual({
      id: "1",
      name: "直播后台",
      url: "https://live.example.com/dashboard",
      width: 900,
      height: 1200,
      cameraDeviceId: "camera-1",
    });
  });
});
