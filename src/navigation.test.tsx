import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useWorkspacePage, workspacePages } from "./navigation";

function RouteProbe() {
  return <h1>{useWorkspacePage()}</h1>;
}

afterEach(cleanup);

describe("workspace hash navigation", () => {
  it.each(workspacePages)("reads the $id deep link", ({ id }) => {
    window.history.replaceState(null, "", `#/${id}`);
    render(<RouteProbe />);
    expect(screen.getByRole("heading").textContent).toBe(id);
  });

  it.each(["", "#/missing", "#transactions-title"])("replaces unsupported route %s with Overview", (hash) => {
    window.history.replaceState(null, "", `/${hash}`);
    const length = window.history.length;
    render(<RouteProbe />);
    expect(screen.getByRole("heading").textContent).toBe("overview");
    expect(window.location.hash).toBe("#/overview");
    expect(window.history.length).toBe(length);
  });

  it("responds to history hash changes and stops listening when unmounted", () => {
    window.history.replaceState(null, "", "#/overview");
    const view = render(<RouteProbe />);
    act(() => {
      window.history.pushState(null, "", "#/budgets");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading").textContent).toBe("budgets");
    view.unmount();
    act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
