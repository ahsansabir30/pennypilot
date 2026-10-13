import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((fulfil, fail) => { resolve = fulfil; reject = fail; });
  return { promise, resolve, reject };
}

function isCommandArgs(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof ArrayBuffer);
}

function navigate(page: string) {
  act(() => {
    window.history.pushState(null, "", `#/${page}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

describe("financial dashboard", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/transactions");
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
    window.history.replaceState(null, "", "#/overview");
    render(<Dashboard onLock={vi.fn()} />);

    expect(await screen.findByText("£2,500.00")).toBeTruthy();
    expect(screen.getAllByText("£750.00")).toHaveLength(2);
    expect(screen.getByText("£1,800.00")).toBeTruthy();
    expect(screen.queryByText("North Market")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add transaction/ })).toBeNull();
    expect(invokeMock.mock.calls.some(([command]) => command === "list_transactions")).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("list_finance_data", expect.objectContaining({ month: expect.any(String) }));
  });

  it("hides prior totals during month changes, failure and out-of-order responses", async () => {
    const january = deferred<FinanceData>();
    const february = deferred<FinanceData>();
    invokeMock.mockImplementation(async (command, args) => {
      const input = isCommandArgs(args) ? args : {};
      if (command === "list_finance_data") {
        if (input.month === "2024-01") return january.promise;
        if (input.month === "2024-02") return february.promise;
        return financeData;
      }
      if (command === "list_transactions") return transactionPage;
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    navigate("overview");
    const picker = screen.getByLabelText("Dashboard month");
    fireEvent.change(picker, { target: { value: "2024-01" } });
    expect(screen.queryByRole("region", { name: /financial summary/ })).toBeNull();
    expect(screen.queryByText("£2,500.00")).toBeNull();
    fireEvent.change(picker, { target: { value: "2024-02" } });
    await act(async () => february.reject(new Error("Fictional February load failed")));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Fictional February load failed"));
    expect(screen.queryByRole("region", { name: /financial summary/ })).toBeNull();
    await act(async () => january.resolve({ ...financeData, summary: { ...financeData.summary, month: "2024-01" } }));
    expect(screen.queryByText("£2,500.00")).toBeNull();
    expect(picker).toHaveProperty("value", "2024-02");
  });

  it("does not retain actionable rows during a pending or failed filter request", async () => {
    const pending = deferred<TransactionPage>();
    invokeMock.mockImplementation(async (command, args) => {
      const input = isCommandArgs(args) ? args : {};
      if (command === "list_finance_data") return financeData;
      if (command === "list_transactions") return isCommandArgs(input.filter) &&
        input.filter.search === "Delayed" ? pending.promise : transactionPage;
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    fireEvent.change(screen.getByRole("textbox", { name: "Search transactions" }), { target: { value: "Delayed" } });
    expect(screen.queryByText("North Market")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete North Market" })).toBeNull();
    expect(screen.getByText("Loading transactions...")).toBeTruthy();
    await act(async () => pending.reject(new Error("Fictional search failed")));
    expect(await screen.findByText("Records unavailable")).toBeTruthy();
    expect(screen.queryByText("No transactions match these filters.")).toBeNull();
    expect(screen.queryByText("North Market")).toBeNull();
  });

  it("hides stale aggregates and rows when a post-mutation refresh fails", async () => {
    let changed = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_finance_data") {
        if (changed) throw new Error("Fictional summary refresh failed");
        return financeData;
      }
      if (command === "list_transactions") {
        if (changed) throw new Error("Fictional records refresh failed");
        return transactionPage;
      }
      if (command === "delete_transaction") { changed = true; return; }
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    fireEvent.click(await screen.findByRole("button", { name: "Delete North Market" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("Fictional summary refresh failed");
    expect(screen.queryByText("North Market")).toBeNull();
    navigate("overview");
    expect(screen.queryByRole("region", { name: /financial summary/ })).toBeNull();
    expect(screen.queryByText("North Market")).toBeNull();
    expect(screen.queryByText("£2,500.00")).toBeNull();
  });

  it.each([1, 11])("clamps the page after deleting the final page's only record from $0 records", async (count) => {
    let records = Array.from({ length: count }, (_, index) => ({
      ...transactionPage.transactions[0], id: index + 1, merchant: `Fictional merchant ${index + 1}`,
    }));
    invokeMock.mockImplementation(async (command, args) => {
      const input = isCommandArgs(args) ? args : {};
      if (command === "list_finance_data") return financeData;
      if (command === "list_transactions") {
        const filter = input.filter;
        const page = filter && typeof filter === "object" && "page" in filter && typeof filter.page === "number" ? filter.page : 0;
        return { ...transactionPage, total: records.length, page, transactions: records.slice(page * 10, (page + 1) * 10) };
      }
      if (command === "delete_transaction") { records = records.filter((record) => record.id !== input.transactionId); return; }
      return planningFixture(command);
    });
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("Fictional merchant 1");
    if (count > 10) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: `Delete Fictional merchant ${count}` }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    if (count > 10) {
      await screen.findByText("1–10 of 10");
      expect(screen.queryByText("No transactions this month.")).toBeNull();
      expect(screen.getByText("Fictional merchant 1")).toBeTruthy();
    } else {
      await screen.findByText("No records");
      expect(screen.getByText("No transactions this month.")).toBeTruthy();
    }
    expect(screen.queryByText("11–10 of 10")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Edit category for North Market" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Category for North Market" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save category choice" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_transaction_category", {
        transactionId: 8,
        categoryId: null,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete North Market" }));
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

  it("keeps categorisation provenance hidden and only clears an override through Use rules", async () => {
    render(<Dashboard onLock={vi.fn()} />);
    await screen.findByText("North Market");
    expect(screen.queryByText("Manual choice. Rules cannot overwrite this category.")).toBeNull();
    expect(screen.queryByText("Manual")).toBeNull();
    expect(screen.queryByText("Automatic")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit category for North Market" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Edit category for North Market" }));
    const select = await screen.findByRole("combobox", { name: "Category for North Market" });
    expect(select).toHaveProperty("value", choice);
    fireEvent.change(select, { target: { value: choice } });
    fireEvent.click(screen.getByRole("button", { name: "Save category choice" }));
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
    navigate("overview");
    expect(screen.queryByText(/Recorded activity · GBP|not an account balance/)).toBeNull();
    expect(screen.getByText("Net cash flow")).toBeTruthy();
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
    window.history.replaceState(null, "", "#/overview");
    render(<Dashboard onLock={vi.fn()} />);
    const budgetPreview = await screen.findByRole("article", { name: "Budgets" });
    expect(await within(budgetPreview).findByText("£38.00 left")).toBeTruthy();
    expect(within(budgetPreview).getByRole("link", { name: "View budgets" })).toHaveProperty("hash", "#/budgets");
    navigate("budgets");
    expect(screen.getByRole("heading", { name: "Budgets", level: 1 })).toBe(document.activeElement);
    fireEvent.click(await screen.findByRole("button", { name: "Edit budget for Groceries" }));
    fireEvent.change(screen.getByLabelText("Monthly limit (GBP)"), { target: { value: "20.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save monthly budget" }));
    await screen.findByText("Budget saved for October 2026.");
    navigate("overview");
    expect(await screen.findByText("£8.00 left")).toBeTruthy();
    navigate("savings");
    expect(screen.getByRole("heading", { name: "Savings", level: 1 })).toBe(document.activeElement);
    fireEvent.click(await screen.findByRole("button", { name: "Edit goal Fictional reserve" }));
    fireEvent.change(screen.getByLabelText("Entered progress (GBP)"), { target: { value: "20.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save savings goal" }));
    await screen.findByText("Savings goal saved.");
    navigate("overview");
    expect(await screen.findByText("20% saved")).toBeTruthy();
    expect(screen.getByText("£80.00 to go")).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Delete North Market" }));
    fireEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    navigate("backup");
    fireEvent.change(screen.getByLabelText("Local backup file path"), { target: { value: "/fictional/example.ppbackup" } });
    fireEvent.change(screen.getByLabelText("Restore backup passphrase"), { target: { value: "fictional-backup-password" } });
    fireEvent.change(screen.getByLabelText("Type RESTORE to confirm"), { target: { value: "RESTORE" } });
    fireEvent.click(screen.getByLabelText(/Replace all current accounts/));
    fireEvent.click(screen.getByRole("button", { name: "Validate and restore backup" }));
    await waitFor(() => expect(screen.getByLabelText("Restore backup passphrase")).toHaveProperty("value", ""));
    navigate("overview");
    expect(await screen.findByText("Restored category")).toBeTruthy();
    navigate("transactions");
    await screen.findByText("No records");
    expect(screen.queryByText("North Market")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save transaction" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search transactions" })).toHaveProperty("value", "");
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
    expect(screen.getByText("Category conflict")).toBeTruthy();
    expect(screen.getByText("Category conflict").closest("details")).toHaveProperty("open", false);
    expect(screen.queryByRole("button", { name: "Use rules for North Market" })).toBeNull();
    navigate("categories");
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply rules to automatic transactions" })).toHaveProperty("disabled", false));
    fireEvent.click(await screen.findByRole("button", { name: "Apply rules to automatic transactions" }));
    await screen.findByText("1 automatic transaction reclassified. Manual choices preserved.");
    navigate("overview");
    await waitFor(() => expect(screen.getByText("Dining")).toBeTruthy());
  });

  it("enforces calendar boundaries on date pickers and describes overview activity", async () => {
    navigate("overview");
    render(<Dashboard onLock={vi.fn()} />);
    const monthPicker = await screen.findByLabelText("Dashboard month");
    expect(monthPicker.getAttribute("min")).toBe("1000-01");
    expect(monthPicker.getAttribute("max")).toBe("9999-12");
    expect(screen.getByText("Search, filter and manage your recorded income, expenses and transfers.")).toBeTruthy();

    navigate("transactions");
    fireEvent.click(await screen.findByRole("button", { name: /Add transaction/ }));
    const dateInput = screen.getByLabelText("Transaction date");
    expect(dateInput.getAttribute("min")).toBe("1000-01-01");
    expect(dateInput.getAttribute("max")).toBe("9999-12-31");
  });
});
