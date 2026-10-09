export type TransactionKind = "income" | "expense" | "refund" | "transfer";

export type Account = {
  id: number;
  name: string;
  currencyCode: "GBP";
};

export type Category = {
  id: number;
  name: string;
  categoryType: "income" | "expense";
  color: string;
};

export type MonthlySummary = {
  month: string;
  incomePence: number;
  expensePence: number;
  refundPence: number;
  netCashFlowPence: number;
};

export type CategorySpending = {
  categoryId: number | null;
  categoryName: string;
  color: string;
  amountPence: number;
};

export type FinanceData = {
  summary: MonthlySummary;
  history: MonthlySummary[];
  categorySpending: CategorySpending[];
  accounts: Account[];
  categories: Category[];
};

export type Transaction = {
  id: number;
  accountId: number;
  categoryId: number | null;
  categoryName: string | null;
  amountPence: number;
  kind: TransactionKind;
  transactionDate: string;
  description: string;
  merchant: string | null;
  merchantNormalized: string | null;
  categorySource: "manual" | "rule" | "uncategorised" | "transfer";
  categoryExplanation: string;
};

export type CategoryRule = {
  id: number;
  pattern: string;
  matchType: "exact" | "contains";
  categoryId: number;
  priority: number;
  enabled: boolean;
};

export type TransactionPage = {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
};

export type BudgetRow = {
  categoryId: number; categoryName: string; limitPence: number; usedPence: number;
  previousUsedPence: number | null; recordCount: number; previousRecordCount: number;
};

export type BudgetData = {
  month: string; asOf: string; periodEnd: string | null; previousMonth: string;
  previousEnd: string | null; comparisonMode: string; rows: BudgetRow[];
};

export type SavingsGoal = {
  id: number; name: string; targetPence: number; progressPence: number;
  targetDate: string | null; notes: string;
};

export function poundsToPence(value: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const pounds = Number(match[1]);
  const pence = Number((match[2] ?? "").padEnd(2, "0"));
  return pounds * 100 + pence;
}

export function formatPence(amountPence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amountPence / 100);
}

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function financeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "PennyPilot could not load or save this financial data.";
}
