import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dashboard } from "../Dashboard";
import { Settings } from "../Settings";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "cmd_load_stats") return {};
    if (command === "cmd_load_history") return [];
    return null;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "windows"),
}));

vi.mock("../HomePage", () => ({
  HomePage: () => null,
}));

vi.mock("../VoiceSettings", () => ({
  VoiceSettings: () => null,
}));

vi.mock("../polish/PolishProviderManager", () => ({
  PolishProviderManager: () => null,
}));

vi.mock("../GeneralSettings", () => ({
  GeneralSettings: () => null,
}));

vi.mock("../About", () => ({
  About: () => null,
}));

describe("Live window navigation", () => {
  it("shows live window management as a main navigation item", () => {
    render(<Dashboard onOpenSettings={() => {}} />);

    expect(screen.getByRole("button", { name: "直播" })).toBeInTheDocument();
  });

  it("does not show live window management inside settings", () => {
    render(<Settings />);

    expect(screen.queryByRole("button", { name: "直播窗口" })).not.toBeInTheDocument();
  });
});
