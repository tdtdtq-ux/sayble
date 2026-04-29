import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HotkeyRecorder } from "../HotkeyRecorder";

describe("HotkeyRecorder", () => {
  it("should display current value", () => {
    render(<HotkeyRecorder value="右Ctrl" onChange={() => {}} />);
    expect(screen.getByText("右Ctrl")).toBeInTheDocument();
  });

  it("should show placeholder when no value", () => {
    render(<HotkeyRecorder value="" onChange={() => {}} />);
    expect(screen.getByText("点击设置快捷键")).toBeInTheDocument();
  });

  it("should have recorder trigger", () => {
    render(<HotkeyRecorder value="" onChange={() => {}} />);
    expect(screen.getByText("点击设置快捷键")).toBeInTheDocument();
  });

  it("should show clear button when value exists", () => {
    render(<HotkeyRecorder value="左Ctrl + Space" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "清除快捷键" })).toBeInTheDocument();
  });

  it("should not show clear button when no value", () => {
    render(<HotkeyRecorder value="" onChange={() => {}} />);
    expect(screen.queryByText("清除")).not.toBeInTheDocument();
  });

  it("should call onChange with empty string on clear", () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="右Ctrl" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "清除快捷键" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("should enter recording mode on click", () => {
    render(<HotkeyRecorder value="" onChange={() => {}} />);
    fireEvent.click(screen.getByText("点击设置快捷键"));
    expect(screen.getByText("按下快捷键...")).toBeInTheDocument();
  });
});
