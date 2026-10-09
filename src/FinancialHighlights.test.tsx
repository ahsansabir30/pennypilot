import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import FinancialHighlights from "./FinancialHighlights";
import type { BudgetData, SavingsGoal } from "./finance";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const budgets: BudgetData = {
  month: "2024-02", asOf: "2024-02-09", periodEnd: "2024-02-09", previousMonth: "2024-01",
  previousEnd: null, comparisonMode: "same_day", rows: [
    { categoryId: 1, categoryName: "Fictional food", limitPence: 10_000, usedPence: "12345", previousUsedPence: null, recordCount: 2, previousRecordCount: 0 },
  ],
};
const goal: SavingsGoal = { id: 1, name: "Fictional rainy day", targetPence: 10_000, progressPence: 0, targetDate: null, notes: "Private note" };
const props = { month: "2024-02", refreshKey: 0, onBudgets: vi.fn(), onGoals: vi.fn() };

describe("dashboard financial highlights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.mockReset();
    mock.mockImplementation(async (command) => command === "list_budgets" ? budgets : [goal]);
  });
  afterEach(cleanup);

  it("orders large usage exactly and retains exact preview allowance pence", async () => {
    mock.mockImplementation(async (command) => command === "list_budgets" ? {
      ...budgets, rows: Array.from({ length: 4 }, (_, index) => ({
        ...budgets.rows[0], categoryId: index + 1, categoryName: `Exact category ${index + 1}`,
        usedPence: String(9_007_199_254_740_992n + BigInt(index)),
      })),
    } : []);
    render(<FinancialHighlights {...props} />);
    const overview = screen.getByRole("region", { name: "Budget and savings overview" });
    expect(await within(overview).findByText("£90,071,992,547,309.95 over")).toBeTruthy();
    expect(within(overview).getAllByRole("listitem").map((item) => item.textContent?.match(/Exact category \d/)?.[0]))
      .toEqual(["Exact category 4", "Exact category 3", "Exact category 2"]);
    expect(screen.queryByText("Exact category 1")).toBeNull();
    expect(screen.getByText(/4 budgeted categories · 4 over limit/)).toBeTruthy();
  });

  it("shows persisted allowance and explicit savings progress without invented balances or projections", async () => {
    render(<FinancialHighlights {...props} />);
    expect(await screen.findByText("£23.45 over")).toBeTruthy();
    expect(screen.getByText("Over limit")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Fictional food allowance used" })).toHaveProperty("value", 100);
    expect(await screen.findByText("0% saved")).toBeTruthy();
    expect(screen.getByText("£100.00 to go")).toBeTruthy();
    expect(screen.getByText(/Recorded through 2024-02-09/)).toBeTruthy();
    expect(screen.getByText(/history may be incomplete/)).toBeTruthy();
    expect(screen.queryByText("Private note")).toBeNull();
  });

  it("retains refund-only allowance and overfunding without clipping the amounts", async () => {
    mock.mockImplementation(async (command) => command === "list_budgets"
      ? { ...budgets, rows: [{ ...budgets.rows[0], usedPence: "-500" }] } : [{ ...goal, progressPence: 12_345 }]);
    render(<FinancialHighlights {...props} />);
    expect(await screen.findByText("£105.00 left")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Fictional food allowance used" })).toHaveProperty("value", 0);
    expect(await screen.findByText("£123.45 of £100.00")).toBeTruthy();
    expect(screen.getByText("Target reached")).toBeTruthy();
    expect(screen.getByText("£0.00 to go")).toBeTruthy();
  });

  it("provides actionable empty states and does not round an unfinished goal up to completion", async () => {
    mock.mockImplementation(async (command) => command === "list_budgets" ? { ...budgets, rows: [] } : []);
    const view = render(<FinancialHighlights {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set your first budget" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create your first goal" }));
    expect(props.onBudgets).toHaveBeenCalledOnce();
    expect(props.onGoals).toHaveBeenCalledOnce();
    mock.mockImplementation(async (command) => command === "list_budgets" ? budgets : [{ ...goal, progressPence: 9_999 }]);
    view.rerender(<FinancialHighlights {...props} refreshKey={1} />);
    expect(await screen.findByText("99.9% saved")).toBeTruthy();
    expect(screen.queryByText("Target reached")).toBeNull();
  });

  it("keeps independent panels usable and retries a failed request without presenting zero as success", async () => {
    let failed = true;
    mock.mockImplementation(async (command) => {
      if (command === "list_savings_goals") return [goal];
      if (failed) throw "Budget records could not be loaded.";
      return budgets;
    });
    render(<FinancialHighlights {...props} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Budget records could not be loaded."));
    expect(await screen.findByText("0% saved")).toBeTruthy();
    expect(screen.queryByText("No budgets this month.")).toBeNull();
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry budget overview" }));
    expect(await screen.findByText("£23.45 over")).toBeTruthy();
  });

  it("hides stale month data during loading and ignores a late response after navigation", async () => {
    let resolveFirst: (value: BudgetData) => void = () => { throw new Error("request not started"); };
    mock.mockImplementation(async (command, args) => {
      if (command === "list_savings_goals") return [];
      if (args && "month" in args && args.month === "2024-02") return new Promise<BudgetData>((resolve) => { resolveFirst = resolve; });
      return { ...budgets, month: "2024-03", rows: [] };
    });
    const view = render(<FinancialHighlights {...props} />);
    expect(screen.getByText("Loading your budget plan...")).toBeTruthy();
    view.rerender(<FinancialHighlights {...props} month="2024-03" />);
    await screen.findByText("No budgets this month.");
    resolveFirst(budgets);
    await waitFor(() => expect(screen.queryByText("£23.45 over")).toBeNull());
    expect(mock).toHaveBeenCalledWith("list_budgets", expect.objectContaining({ month: "2024-03" }));
  });

  it("bounds the previews while making the full lists discoverable", async () => {
    mock.mockImplementation(async (command) => command === "list_budgets" ? {
      ...budgets, rows: Array.from({ length: 4 }, (_, index) => ({ ...budgets.rows[0], categoryId: index + 1, categoryName: `Fictional category ${index + 1}`, usedPence: index === 3 ? "25000" : "1000" })),
    } : Array.from({ length: 4 }, (_, index) => ({ ...goal, id: index + 1, name: `Fictional goal ${index + 1}` })));
    render(<FinancialHighlights {...props} />);
    await screen.findByText("Showing 3 of 4 categories, highest usage first. Manage budgets to see all.");
    const overview = screen.getByRole("region", { name: "Budget and savings overview" });
    expect(within(overview).getAllByRole("progressbar")).toHaveLength(6);
    expect(screen.getByText("Fictional category 4")).toBeTruthy();
    expect(screen.queryByText("Fictional category 3")).toBeNull();
    expect(screen.getByText(/4 budgeted categories · 1 over limit/)).toBeTruthy();
    expect(await screen.findByText("Showing 3 of 4 goals. Manage goals to see all.")).toBeTruthy();
  });
});
