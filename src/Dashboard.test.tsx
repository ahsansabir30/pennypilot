import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import Dashboard from "./Dashboard";
import type { FinanceData, TransactionPage } from "./finance";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const categories = [
  { id: 1, name: "Groceries", categoryType: "expense" as const, color: "#D3A348" },
  { id: 2, name: "Salary", categoryType: "income" as const, color: "#4F8B68" },
];
const financeData: FinanceData = {
  summary: {
    month: "2026-10",
    incomePence: "250000",
    expensePence: "75000",
    refundPence: "5000",
    netCashFlowPence: "180000",
  },
  history: [
    {
      month: "2026-05",
      incomePence: "0",
      expensePence: "0",
      refundPence: "0",
      netCashFlowPence: "0",
    },
    {
      month: "2026-06",
      incomePence: "0",
      expensePence: "0",
      refundPence: "0",
      netCashFlowPence: "0",
    },
    {
      month: "2026-07",
      incomePence: "0",
      expensePence: "0",
      refundPence: "0",
      netCashFlowPence: "0",
    },
    {
      month: "2026-08",
      incomePence: "0",
      expensePence: "0",
      refundPence: "0",
      netCashFlowPence: "0",
    },
    {
      month: "2026-09",
      incomePence: "0",
      expensePence: "0",
      refundPence: "0",
      netCashFlowPence: "0",
    },
    {
      month: "2026-10",
      incomePence: "250000",
      expensePence: "70000",
      refundPence: "5000",
      netCashFlowPence: "180000",
    },
  ],
  categorySpending: [
    {
      categoryId: 1,
      categoryName: "Groceries",
      color: "#D3A348",
      amountPence: "70000",
    },
  ],
  accounts: [{ id: 1, name: "Current account", currencyCode: "GBP" }],
  categories,
};
const transactionPage: TransactionPage = {
  transactions: [
    {
      id: 8,
      accountId: 1,
      categoryId: 1,
      categoryName: "Groceries",
      amountPence: 1_234,
      kind: "expense",
      transactionDate: "2026-10-08",
      description: "Weekly food shop",
      merchant: "North Market",
      merchantNormalized: "north market",
      categorySource: "manual",
      categoryExplanation: "Manual choice. Rules cannot overwrite this category.",
    },
  ],
  total: 1,
  page: 0,
  pageSize: 10,
};

function planningFixture(command: string) {
  if (command === "list_budgets") return {
    month: "2026-10", asOf: "2026-10-09", periodEnd: "2026-10-09", previousMonth: "2026-09",
    previousEnd: null, comparisonMode: "same_day", rows: [],
  };
  if (command === "list_savings_goals") return [];
}

describe("financial dashboard", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_finance_data") return financeData;
      if (command === "list_transactions") return transactionPage;
      return planningFixture(command);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows totals and trends returned from persisted finance data", async () => {
    render(<Dashboard onLock={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Financial overview" })).toBeTruthy();
    expect(screen.getByText("£2,500.00")).toBeTruthy();
    expect(screen.getAllByText("£750.00")).toHaveLength(2);
    expect(screen.getByText("£1,800.00")).toBeTruthy();
    expect(screen.getByText("North Market")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("list_finance_data", expect.objectContaining({ month: expect.any(String) }));
  });

  it("creates a transaction using integer pence from the entered decimal", async () => {
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    fireEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "expense" } });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "12.34" } });
    fireEvent.change(screen.getByLabelText("Transaction date"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Lunch" } });
    fireEvent.change(screen.getByLabelText(/Merchant/), { target: { value: "Cafe Corner" } });
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("create_transaction", {
        input: {
          accountId: 1,
          categoryId: 1,
          manualCategory: true,
          amountPence: 1234,
          kind: "expense",
          transactionDate: "2026-10-08",
          description: "Lunch",
          merchant: "Cafe Corner",
        },
      }),
    );
  });

  it("supports bounded category correction and confirmed deletion", async () => {
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    fireEvent.change(screen.getByRole("combobox", { name: "Category for North Market" }), {
      target: { value: "" },
    });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_transaction_category", {
        transactionId: 8,
        categoryId: null,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete North Market" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("delete_transaction", { transactionId: 8 }),
    );
  });

  it.each([
    { choice: "", manual: false, label: "automatic categorisation" },
    { choice: "uncategorised", manual: true, label: "explicit manual Uncategorised" },
  ])("distinguishes $label from the other choice", async ({ choice, manual }) => {
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    fireEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: choice } });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Fictional food shop" } });
    fireEvent.change(screen.getByLabelText(/Merchant/), { target: { value: "NORTH*MARKET" } });
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_transaction", {
      input: expect.objectContaining({ categoryId: null, manualCategory: manual, merchant: "NORTH*MARKET" }),
    }));
  });

  it("explains decisions and only clears a manual override through Use rules", async () => {
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    expect(screen.getByText("Manual choice. Rules cannot overwrite this category.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use rules for North Market" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("reset_transaction_category", { transactionId: 8 }));
  });

  it.each([
    { categoryId: 1, categoryName: "Groceries", choice: "1" },
    { categoryId: null, categoryName: null, choice: "" },
  ])("can make an explicit decision identical to the automatic category $categoryId", async ({ categoryId, categoryName, choice }) => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_finance_data") return financeData;
      if (command === "list_transactions") return {
        ...transactionPage, transactions: [{ ...transactionPage.transactions[0], categoryId, categoryName,
          categorySource: categoryId === null ? "uncategorised" : "rule" }],
      };
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    const select = await screen.findByRole("combobox", { name: "Category for North Market" });
    expect(select).toHaveProperty("value", "automatic");
    fireEvent.change(select, { target: { value: choice } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_transaction_category", {
      transactionId: 8, categoryId,
    }));
  });

  it("lets a filtered empty transaction feed recover without implying missing records are a balance", async () => {
    let filtered = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_finance_data") return financeData;
      if (command === "list_transactions") return filtered ? { ...transactionPage, transactions: [], total: 0 } : transactionPage;
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    filtered = true;
    fireEvent.change(screen.getByRole("textbox", { name: "Search transactions" }), { target: { value: "No match" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by type" }), { target: { value: "expense" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by category" }), { target: { value: "1" } });
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    filtered = false;
    fireEvent.click(clear);
    await screen.findByText("North Market");
    expect(screen.getByRole("textbox", { name: "Search transactions" })).toHaveProperty("value", "");
    expect(screen.getByRole("combobox", { name: "Filter by type" })).toHaveProperty("value", "");
    expect(screen.getByRole("combobox", { name: "Filter by category" })).toHaveProperty("value", "");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.getByText(/not an account balance/)).toBeTruthy();
  });

  it("refreshes home previews after saving a budget or editing entered savings progress", async () => {
    let limitPence = 5_000;
    let progressPence = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_finance_data") return financeData;
      if (command === "list_transactions") return transactionPage;
      if (command === "save_budget") { limitPence = 2_000; return; }
      if (command === "save_savings_goal") { progressPence = 2_000; return; }
      if (command === "list_budgets") return { ...planningFixture(command), rows: [
        { categoryId: 1, categoryName: "Groceries", limitPence, usedPence: "1200", previousUsedPence: null, recordCount: 1, previousRecordCount: 0 },
      ] };
      if (command === "list_savings_goals") return [{ id: 1, name: "Fictional reserve", targetPence: 10_000, progressPence, targetDate: null, notes: "" }];
    });
    render(<Dashboard onLock={vi.fn()} />);
    const budgetPreview = await screen.findByRole("article", { name: "Budget check-in" });
    expect(await within(budgetPreview).findByText("£38.00 left")).toBeTruthy();
    fireEvent.click(within(budgetPreview).getByRole("button", { name: "Manage budgets" }));
    expect(screen.getByRole("heading", { name: "Monthly category budgets" })).toBe(document.activeElement);
    fireEvent.click(await screen.findByRole("button", { name: "Edit budget for Groceries" }));
    fireEvent.change(screen.getByLabelText("Monthly limit (GBP)"), { target: { value: "20.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save monthly budget" }));
    expect(await within(budgetPreview).findByText("£8.00 left")).toBeTruthy();
    const goalPreview = screen.getByRole("article", { name: "Savings at a glance" });
    fireEvent.click(within(goalPreview).getByRole("button", { name: "Manage goals" }));
    expect(screen.getByRole("heading", { name: "Savings goals" })).toBe(document.activeElement);
    fireEvent.click(await screen.findByRole("button", { name: "Edit goal Fictional reserve" }));
    fireEvent.change(screen.getByLabelText("Entered progress (GBP)"), { target: { value: "20.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save savings goal" }));
    expect(await within(goalPreview).findByText("20% saved")).toBeTruthy();
    expect(within(goalPreview).getByText("£80.00 to go")).toBeTruthy();
  });

  it("refreshes restored records and clears stale filters, forms and deletion confirmations", async () => {
    let restored = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_finance_data") return {
        ...financeData, categorySpending: [{ ...financeData.categorySpending[0], categoryName: restored ? "Restored category" : "Groceries" }],
      };
      if (command === "list_transactions") return restored ? { ...transactionPage, transactions: [], total: 0 } : transactionPage;
      if (command === "private_data_locations") return ["/fictional/private-backups"];
      if (command === "restore_private_backup") {
        restored = true;
        return { safetyBackupPath: "/fictional/private-backups/safety.ppbackup", recordCount: 0 };
      }
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    fireEvent.change(screen.getByRole("textbox", { name: "Search transactions" }), { target: { value: "North" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete North Market" }));
    fireEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    fireEvent.click(screen.getByRole("button", { name: "Private export and backup" }));
    fireEvent.change(screen.getByLabelText("Local backup file path"), { target: { value: "/fictional/example.ppbackup" } });
    fireEvent.change(screen.getByLabelText("Restore backup passphrase"), { target: { value: "fictional-backup-password" } });
    fireEvent.change(screen.getByLabelText("Type RESTORE to confirm"), { target: { value: "RESTORE" } });
    fireEvent.click(screen.getByLabelText(/Replace all current accounts/));
    fireEvent.click(screen.getByRole("button", { name: "Validate and restore backup" }));
    expect(await screen.findByText("Restored category")).toBeTruthy();
    expect(screen.queryByText("North Market")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save transaction" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search transactions" })).toHaveProperty("value", "");
    expect(screen.getByLabelText("Restore backup passphrase")).toHaveProperty("value", "");
    expect(invokeMock.mock.calls.filter(([command]) => command === "list_transactions").slice(-1)[0]?.[1])
      .toEqual({ filter: expect.objectContaining({ search: "", categoryId: null, kind: null, page: 0 }) });
  });

  it("shows conflicts and refreshes the category breakdown after reclassification", async () => {
    let reclassified = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_category_rules") return [];
      if (command === "reclassify_transactions") { reclassified = true; return 1; }
      if (command === "list_finance_data") return {
        ...financeData, categorySpending: [{ ...financeData.categorySpending[0], categoryName: reclassified ? "Dining" : "Uncategorised" }],
      };
      if (command === "list_transactions") return {
        ...transactionPage, transactions: [{ ...transactionPage.transactions[0], categoryId: null, categoryName: null, categorySource: "uncategorised",
          categoryExplanation: "Conflict: equal highest priority targets different categories. No category assigned." }],
      };
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    expect(await screen.findByText(/Conflict: equal highest priority/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use rules for North Market" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage categories and rules" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reclassify automatic transactions" })).toHaveProperty("disabled", false));
    fireEvent.click(await screen.findByRole("button", { name: "Reclassify automatic transactions" }));
    await waitFor(() => expect(screen.getByText("Dining")).toBeTruthy());
    expect(screen.getByText("1 automatic transaction reclassified. Manual choices preserved.")).toBeTruthy();
  });
});
