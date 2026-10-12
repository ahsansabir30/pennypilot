import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import Budgets from "./Budgets";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const categories = [{ id: 1, name: "Fictional Food", categoryType: "expense" as const, color: "#123456" }];
const data = { month: "2024-02", asOf: "2024-02-09", periodEnd: "2024-02-09", previousMonth: "2024-01",
  previousEnd: "2024-01-09", comparisonMode: "same_day", rows: [
    { categoryId: 1, categoryName: "Fictional Food", limitPence: 10_000, usedPence: "12345",
      previousUsedPence: null, recordCount: 2, previousRecordCount: 0 },
  ] };

describe("monthly budgets", () => {
  beforeEach(() => { mock.mockReset(); mock.mockImplementation(async (command) => command === "list_budgets" ? data : undefined); });
  afterEach(cleanup);

  it("omits budget explanatory prose, expandable details and comparison controls", async () => {
    render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    await screen.findByRole("list", { name: "Category budgets" });
    expect(screen.queryByText("Period details")).toBeNull();
    expect(screen.queryByText("Calculation details")).toBeNull();
    expect(screen.queryByText(/Expenses less refunds|Limits apply only|No comparable|Previous recorded|through/)).toBeNull();
    expect(screen.queryByText("Recorded spending, not complete bank history.")).toBeNull();
    expect(screen.queryByLabelText("Comparison period")).toBeNull();
  });

  it("retains exact large usage and allowance without displaying comparisons", async () => {
    mock.mockResolvedValue({ ...data, rows: [{ ...data.rows[0], usedPence: "9007199254740993", previousUsedPence: "9007199254740992", previousRecordCount: 1 }] });
    render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    expect(await screen.findByText("£90,071,992,547,409.93 used / £100.00 limit")).toBeTruthy();
    expect(screen.getByText("£90,071,992,547,309.93 over limit.")).toBeTruthy();
    expect(screen.queryByText(/Recorded change:/)).toBeNull();
  });

  it("keeps the earliest supported budget usable without comparison prose", async () => {
    mock.mockResolvedValue({ ...data, month: "1000-01", periodEnd: "1000-01-31", previousMonth: null, previousEnd: null });
    render(<Budgets month="1000-01" categories={categories} refreshKey={0} />);
    expect(await screen.findByText("£123.45 used / £100.00 limit")).toBeTruthy();
    expect(screen.queryByText(/Previous period|no change inferred/)).toBeNull();
    expect(screen.queryByText(/Recorded change:/)).toBeNull();
  });

  it("shows recorded usage, exceeded markers and missing history without inventing a comparison", async () => {
    render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    expect(await screen.findByText("£123.45 used / £100.00 limit")).toBeTruthy();
    expect(screen.getByText("Exceeded budget · 123.5%")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Fictional Food budget progress" })).toHaveProperty("value", 100);
    expect(screen.queryByText(/No comparable category records|through/)).toBeNull();
  });

  it("saves exact pence and edits limits without mutating persisted comparison preferences", async () => {
    render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    await screen.findByRole("list", { name: "Category budgets" });
    fireEvent.click(await screen.findByRole("button", { name: "Edit budget for Fictional Food" }));
    expect(screen.getByRole("heading", { name: "Edit budget limit" })).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).not.toContain("2024-02");
    expect(screen.getByLabelText("Monthly limit (GBP)")).toBe(document.activeElement);
    expect(screen.getByLabelText("Monthly limit (GBP)")).toHaveProperty("value", "100.00");
    fireEvent.change(screen.getByLabelText("Monthly limit (GBP)"), { target: { value: "250.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save monthly budget" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("save_budget", { input: { month: "2024-02", categoryId: 1, limitPence: 25_001 } }));
    await screen.findByText("Budget saved for 2024-02.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Comparison period")).toBeNull();
    expect(mock).not.toHaveBeenCalledWith("save_budget_preferences", expect.anything());
  });

  it("rejects fractional pence and surfaces failed saves", async () => {
    mock.mockImplementation(async (command) => {
      if (command === "list_budgets") return data;
      throw "Workspace is locked.";
    });
    render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    await screen.findByRole("heading", { name: "Fictional Food" });
    fireEvent.click(screen.getByRole("button", { name: "Add budget" }));
    expect(screen.getByRole("dialog").textContent).not.toContain("2024-02");
    fireEvent.change(screen.getByLabelText("Budget category"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Monthly limit (GBP)"), { target: { value: "1.001" } });
    fireEvent.click(screen.getByRole("button", { name: "Save monthly budget" }));
    expect(screen.getByRole("alert").textContent).toContain("positive GBP limit");
    expect(mock).not.toHaveBeenCalledWith("save_budget", expect.anything());
    fireEvent.change(screen.getByLabelText("Monthly limit (GBP)"), { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save monthly budget" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Workspace is locked."));
    expect(screen.getByLabelText("Monthly limit (GBP)")).toHaveProperty("value", "1.00");
    expect(screen.getByLabelText("Budget category")).toHaveProperty("value", "1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel budget" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reloads for manual category changes and confirms removals", async () => {
    const view = render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    await screen.findByRole("button", { name: "Remove budget for Fictional Food" });
    mock.mockClear();
    view.rerender(<Budgets month="2024-02" categories={categories} refreshKey={1} />);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("list_budgets", expect.objectContaining({ month: "2024-02" })));
    fireEvent.click(await screen.findByRole("button", { name: "Remove budget for Fictional Food" }));
    expect(mock).not.toHaveBeenCalledWith("delete_budget", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget removal" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("delete_budget", { month: "2024-02", categoryId: 1 }));
  });

  it("hides old usage during a refresh and does not show it after a failed reload", async () => {
    const view = render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    await screen.findByText("£123.45 used / £100.00 limit");
    let reject!: (error: Error) => void;
    mock.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    view.rerender(<Budgets month="2024-02" categories={categories} refreshKey={1} />);
    expect(screen.queryByText("£123.45 used / £100.00 limit")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove budget for Fictional Food" })).toBeNull();
    expect(screen.getByText("Loading budgets...")).toBeTruthy();
    await act(async () => reject(new Error("Fictional usage reload failed")));
    expect(screen.getByRole("alert").textContent).toContain("Fictional usage reload failed");
    expect(screen.queryByText("£123.45 used / £100.00 limit")).toBeNull();
  });

  it("closes the drilldown on a period change without reopening it for a new month", async () => {
    let finish!: (value: unknown) => void;
    mock.mockImplementation(async (command, args) => {
      if (command === "list_transactions") return new Promise((resolve) => { finish = resolve; });
      return { ...data, month: (args as { month: string }).month };
    });
    const view = render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "View transactions for Fictional Food" }));
    expect(screen.getByText("Loading budget transactions...")).toBeTruthy();
    view.rerender(<Budgets month="2024-03" categories={categories} refreshKey={0} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByRole("button", { name: "View transactions for Fictional Food" });
    await act(async () => finish({ page: 0, pageSize: 10, total: 0, transactions: [] }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps pending budget inputs fixed and labels missing records honestly", async () => {
    let finishSave: (() => void) | undefined;
    mock.mockImplementation(async (command) => {
      if (command === "list_budgets") return { ...data, rows: [{ ...data.rows[0], usedPence: "0", recordCount: 0 }] };
      if (command === "save_budget") return new Promise<void>((resolve) => { finishSave = resolve; });
    });
    render(<Budgets month="2024-02" categories={categories} refreshKey={0} />);
    await screen.findByText("No records yet · 0.0%");
    expect(screen.queryByText(/Within limit/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit budget for Fictional Food" }));
    fireEvent.click(screen.getByRole("button", { name: "Save monthly budget" }));
    await waitFor(() => expect(finishSave).toBeDefined());
    expect(screen.getByLabelText("Budget category")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Monthly limit (GBP)")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Cancel budget" })).toHaveProperty("disabled", true);
    if (!finishSave) throw new Error("Expected a pending budget save.");
    finishSave();
    await screen.findByText("Budget saved for 2024-02.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
