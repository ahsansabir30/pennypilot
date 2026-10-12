import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeToggle from "./ThemeToggle";
import { readThemePreference, themeStorageKey } from "./theme";

let systemDark = false;
let listener: (() => void) | undefined;

beforeEach(() => {
  systemDark = false;
  listener = undefined;
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return systemDark; },
    addEventListener: (_: string, callback: () => void) => { listener = callback; },
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});

describe("ThemeToggle", () => {
  it("follows the system theme until the user chooses one", () => {
    systemDark = true;
    render(<ThemeToggle />);
    expect(screen.getByRole("switch", { name: "Dark mode" }).getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    systemDark = false;
    act(() => listener?.());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(themeStorageKey)).toBeNull();
  });

  it("switches and remembers the chosen theme", () => {
    const first = render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");

    first.unmount();
    delete document.documentElement.dataset.themePreference;
    render(<ThemeToggle />);
    expect(screen.getByRole("switch", { name: "Dark mode" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");
  });

  it("ignores invalid or unavailable stored preferences", () => {
    window.localStorage.setItem(themeStorageKey, "purple");
    expect(readThemePreference()).toBe("system");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readThemePreference()).toBe("system");
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("status").textContent).toContain("could not be saved");
    expect(warn).toHaveBeenCalled();
    expect(readThemePreference()).toBe("dark");
  });
});
