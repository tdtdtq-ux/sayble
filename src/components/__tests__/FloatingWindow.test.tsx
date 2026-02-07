import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FloatingWindow } from "../FloatingWindow";

describe("FloatingWindow", () => {
  it("should not render when status is idle", () => {
    const { container } = render(
      <FloatingWindow
        status="idle"
        partialText=""
        finalText=""
        duration={0}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("should render recording state", () => {
    render(
      <FloatingWindow
        status="recording"
        partialText=""
        finalText=""
        duration={5000}
      />
    );
    expect(screen.getByText("录音中")).toBeInTheDocument();
    expect(screen.getByText("00:05")).toBeInTheDocument();
    expect(screen.getByText("请开始说话...")).toBeInTheDocument();
  });

  it("should show partial text during recording", () => {
    render(
      <FloatingWindow
        status="recording"
        partialText="你好世界"
        finalText=""
        duration={3000}
      />
    );
    expect(screen.getByText("你好世界")).toBeInTheDocument();
  });

  it("should render recognizing state", () => {
    render(
      <FloatingWindow
        status="recognizing"
        partialText="正在处理"
        finalText=""
        duration={0}
      />
    );
    expect(screen.getByText("识别中")).toBeInTheDocument();
    expect(screen.getByText("正在处理")).toBeInTheDocument();
  });

  it("should render done state with final text", () => {
    render(
      <FloatingWindow
        status="done"
        partialText=""
        finalText="识别完成的文字"
        duration={0}
      />
    );
    expect(screen.getByText("识别完成")).toBeInTheDocument();
    expect(screen.getByText("识别完成的文字")).toBeInTheDocument();
  });

  it("should show cancel button during recording", () => {
    render(
      <FloatingWindow
        status="recording"
        partialText=""
        finalText=""
        duration={0}
      />
    );
    expect(screen.getByText("Esc 取消")).toBeInTheDocument();
  });

  it("should show cancel button during recognizing", () => {
    render(
      <FloatingWindow
        status="recognizing"
        partialText=""
        finalText=""
        duration={0}
      />
    );
    expect(screen.getByText("Esc 取消")).toBeInTheDocument();
  });

  it("should format duration correctly", () => {
    render(
      <FloatingWindow
        status="recording"
        partialText=""
        finalText=""
        duration={65000}
      />
    );
    expect(screen.getByText("01:05")).toBeInTheDocument();
  });
});
