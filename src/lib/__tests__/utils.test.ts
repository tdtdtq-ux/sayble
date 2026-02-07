import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn utility", () => {
  it("should merge class names", () => {
    const result = cn("foo", "bar");
    expect(result).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    const result = cn("base", true && "active", false && "disabled");
    expect(result).toBe("base active");
  });

  it("should merge tailwind conflicts", () => {
    const result = cn("px-4", "px-6");
    expect(result).toBe("px-6");
  });

  it("should handle undefined and null", () => {
    const result = cn("base", undefined, null, "end");
    expect(result).toBe("base end");
  });

  it("should handle empty input", () => {
    const result = cn();
    expect(result).toBe("");
  });
});
