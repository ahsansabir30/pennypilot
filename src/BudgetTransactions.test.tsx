import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import BudgetTransactions from "./BudgetTransactions";
import { budgetTransactionFilter } from "./finance";
import type { TransactionPage } from "./finance";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const props = { month: "2024-02", categoryId: 1, categoryName: "Fictional Food",
  periodEnd: "2024-02-15", refreshKey: "0", onClose: vi.fn() };
const data: TransactionPage = { page: 0, pageSize: 10, total: 11, transactions: [{
  id: 3, accountId: 1, categoryId: 1, categoryName: "Fictional Food", amountPence: 300,
  kind: "refund", transactionDate: "2024-02-03", description: "Fictional refund", merchant: null,
  merchantNormalized: null, categorySource: "manual", categoryExplanation: "Manual choice.",
}] };

describe("budget transaction popup", () => {
  beforeEach(() => { mock.mockReset(); props.onClose.mockClear(); });
  afterEach(cleanup);

  it("uses a bounded spending filter and never queries a future/no elapsed period", () => {
    expect(budgetTransactionFilter("2024-02", 1, "2024-02-29", 2)).toEqual({
      month: "2024-02", categoryId: 1, kind: "spending", throughDate: "2024-02-29",
      search: "", sort: "date_desc", page: 2, pageSize: 10,
    });
    render(<BudgetTransactions {...props} periodEnd={null} />);
    expect(screen.getByText("No spending yet this month.")).toBeTruthy();
    expect(mock).not.toHaveBeenCalled();
  });

  it("shows signed refunds, current manual choices and server pagination", async () => {
    mock.mockResolvedValue(data);
    render(<BudgetTransactions {...props} />);
    expect(await screen.findByText("-£3.00")).toBeTruthy();
    expect(screen.getByText(/Refund/)).toBeTruthy();
    expect(screen.queryByText(/Manual category|Current category choices|Expenses less refunds|through/)).toBeNull();
    expect(screen.getByRole("button", { name: "Next transactions" }).textContent).toBe("");
    expect(mock).toHaveBeenCalledWith("list_transactions", { filter: budgetTransactionFilter(props.month, 1, props.periodEnd, 0) });
    fireEvent.click(screen.getByRole("button", { name: "Next transactions" }));
    await waitFor(() => expect(mock).toHaveBeenLastCalledWith("list_transactions", {
      filter: budgetTransactionFilter(props.month, 1, props.periodEnd, 1),
    }));
    expect(await screen.findByText("11 of 11 transactions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous transactions" }));
    await screen.findByText("1–10 of 11 transactions");
    fireEvent.click(screen.getByRole("button", { name: "Close transactions" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("allows dismissal during loading, hides failed rows and retries", async () => {
    let fail!: (error: unknown) => void;
    mock.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    render(<BudgetTransactions {...props} />);
    expect(screen.getByText("Loading budget transactions...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close transactions" })).toHaveProperty("disabled", false);
    await act(async () => fail("Fictional query failed."));
    expect(screen.getByRole("alert").textContent).toContain("Fictional query failed.");
    expect(screen.queryByRole("list")).toBeNull();
    mock.mockResolvedValue({ ...data, total: 0, transactions: [] });
    fireEvent.click(screen.getByRole("button", { name: "Retry budget transactions" }));
    expect(await screen.findByText("No transactions in this budget period.")).toBeTruthy();
  });

  it("hides cached rows on scope/refresh changes and ignores late old responses", async () => {
    let finish!: (value: TransactionPage) => void;
    mock.mockImplementationOnce(() => new Promise<TransactionPage>((resolve) => { finish = resolve; }));
    const view = render(<BudgetTransactions {...props} />);
    mock.mockResolvedValue({ ...data, transactions: [{ ...data.transactions[0], merchant: "Fictional current record" }] });
    view.rerender(<BudgetTransactions {...props} categoryId={2} categoryName="Fictional Travel" />);
    await screen.findByText("Fictional current record");
    await act(async () => finish(data));
    expect(screen.getByText("Fictional current record")).toBeTruthy();
    mock.mockRejectedValue("Fictional refresh failed.");
    view.rerender(<BudgetTransactions {...props} refreshKey="1" />);
    expect(screen.queryByText("Fictional current record")).toBeNull();
    await screen.findByRole("alert");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("clamps a now-unavailable page after a record is removed", async () => {
    mock.mockResolvedValueOnce(data).mockResolvedValueOnce({ ...data, page: 1, total: 1, transactions: [] })
      .mockResolvedValue({ ...data, total: 1 });
    render(<BudgetTransactions {...props} />);
    await screen.findByText("-£3.00");
    fireEvent.click(screen.getByRole("button", { name: "Next transactions" }));
    await screen.findByText("1 transaction");
    expect(screen.getByRole("button", { name: "Next transactions" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Previous transactions" })).toHaveProperty("disabled", true);
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
