import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    incomePence: 250_000,
    expensePence: 75_000,
    refundPence: 5_000,
    netCashFlowPence: 180_000,
  },
  history: [
    {
      month: "2026-05",
      incomePence: 0,
      expensePence: 0,
      refundPence: 0,
      netCashFlowPence: 0,
    },
    {
      month: "2026-06",
      incomePence: 0,
      expensePence: 0,
      refundPence: 0,
      netCashFlowPence: 0,
    },
    {
      month: "2026-07",
      incomePence: 0,
      expensePence: 0,
      refundPence: 0,
      netCashFlowPence: 0,
    },
    {
      month: "2026-08",
      incomePence: 0,
      expensePence: 0,
      refundPence: 0,
      netCashFlowPence: 0,
    },
    {
      month: "2026-09",
      incomePence: 0,
      expensePence: 0,
      refundPence: 0,
      netCashFlowPence: 0,
    },
    {
      month: "2026-10",
      incomePence: 250_000,
      expensePence: 70_000,
      refundPence: 5_000,
      netCashFlowPence: 180_000,
    },
  ],
  categorySpending: [
    {
      categoryId: 1,
      categoryName: "Groceries",
      color: "#D3A348",
      amountPence: 70_000,
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
    },
  ],
  total: 1,
  page: 0,
  pageSize: 10,
};

describe("financial dashboard", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "list_finance_data") return financeData;
      if (command === "list_transactions") return transactionPage;
      return undefined;
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
});
