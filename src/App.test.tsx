import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const emptyFinanceData = {
  summary: {
    month: new Date().toISOString().slice(0, 7),
    incomePence: "0",
    expensePence: "0",
    refundPence: "0",
    netCashFlowPence: "0",
  },
  history: [],
  categorySpending: [],
  accounts: [{ id: 1, name: "Main account", currencyCode: "GBP" }],
  categories: [
    { id: 1, name: "Other spending", categoryType: "expense", color: "#8B918C" },
    { id: 2, name: "Salary", categoryType: "income", color: "#4F8B68" },
  ],
};
const emptyTransactions = {
  transactions: [],
  total: 0,
  page: 0,
  pageSize: 10,
};

describe("workspace setup and access", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.mocked(isTauri).mockReturnValue(true);
    invokeMock.mockImplementation(async (command) => {
      if (command === "workspace_status") return "locked";
      if (command === "list_finance_data") return emptyFinanceData;
      if (command === "list_budgets") return {
        month: "2026-10", asOf: "2026-10-09", periodEnd: null, previousMonth: "2026-09",
        previousEnd: null, comparisonMode: "same_day", rows: [],
      };
      if (command === "list_savings_goals") return [];
      if (command === "list_transactions") return emptyTransactions;
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("explains browser access without invoking native APIs or asking for credentials", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    expect(screen.getByRole("heading", { name: "Open PennyPilot on desktop" })).toBeTruthy();
    expect(screen.getByText(/npm run tauri dev/)).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Passphrase")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the same brand artwork through unlock and lock", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Unlock your workspace" });
    function expectBrand() {
      const mark = container.querySelector(".brand img");
      expect(mark?.getAttribute("src")).toBe("/pennypilot.svg");
      expect(mark?.getAttribute("alt")).toBe("");
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelector(".brand")?.textContent).toBe("PennyPilot");
    }
    expectBrand();
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "a memorable long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByRole("heading", { name: "Overview" });
    expectBrand();
    fireEvent.click(screen.getByRole("button", { name: "Lock workspace" }));
    await screen.findByRole("heading", { name: "Unlock your workspace" });
    expectBrand();
  });

  it("creates a workspace and clears the passphrase after success", async () => {
    invokeMock.mockResolvedValueOnce("new");
    invokeMock.mockResolvedValueOnce(undefined);

    render(<App />);

    await screen.findByRole("heading", { name: "Create your workspace" });
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "a memorable long passphrase" },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "a memorable long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create secure workspace/ }));

    await screen.findByRole("heading", { name: "Overview" });
    expect(invokeMock).toHaveBeenCalledWith("create_workspace_command", {
      passphrase: "a memorable long passphrase",
    });
  });

  it("surfaces an unlock error without presenting a success state", async () => {
    invokeMock.mockResolvedValueOnce("locked");
    invokeMock.mockRejectedValueOnce(
      "The passphrase could not unlock this workspace.",
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Unlock your workspace" });
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "incorrect passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The passphrase could not unlock this workspace.",
    );
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
  });

  it("uses on-device recovery to replace a forgotten passphrase", async () => {
    invokeMock.mockResolvedValueOnce("locked");
    invokeMock.mockResolvedValueOnce(undefined);

    render(<App />);

    await screen.findByRole("heading", { name: "Unlock your workspace" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Forgot your passphrase? Recover on this device",
      }),
    );
    await screen.findByRole("heading", { name: "Set a new passphrase" });
    fireEvent.change(screen.getByLabelText("New passphrase"), {
      target: { value: "replacement passphrase for workspace" },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "replacement passphrase for workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Recover and continue/ }));

    await screen.findByRole("heading", { name: "Overview" });
    expect(invokeMock).toHaveBeenCalledWith(
      "recover_workspace_command",
      { passphrase: "replacement passphrase for workspace" },
    );
  });
});
