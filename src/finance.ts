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
  incomePence: string;
  expensePence: string;
  refundPence: string;
  netCashFlowPence: string;
};

export type CategorySpending = {
  categoryId: number | null;
  categoryName: string;
  color: string;
  amountPence: string;
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
  categoryId: number; categoryName: string; limitPence: number; usedPence: string;
  previousUsedPence: string | null; recordCount: number; previousRecordCount: number;
};

export type BudgetData = {
  month: string; asOf: string; periodEnd: string | null; previousMonth: string | null;
  previousEnd: string | null; comparisonMode: string; rows: BudgetRow[];
};

// A missing elapsed period must never become an unbounded month query.
export function budgetTransactionFilter(month: string, categoryId: number, periodEnd: string | null, page: number) {
  if (periodEnd === null) return null;
  return { month, categoryId, kind: "spending", throughDate: periodEnd,
    search: "", sort: "date_desc", page, pageSize: 10 };
}

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

export function absolutePence(pence: bigint): bigint {
  return pence < 0n ? -pence : pence;
}

// Only visual proportions use floating point; currency arithmetic stays exact.
export function penceRatio(pence: bigint, total: bigint): number {
  return Number(pence) / Number(total);
}

export function formatPence(amountPence: number | string | bigint): string {
  if (typeof amountPence === "number" && !Number.isSafeInteger(amountPence)) {
    throw new RangeError("Currency pence must be a safe integer or an exact decimal string.");
  }
  const pence = BigInt(amountPence);
  const magnitude = absolutePence(pence);
  return `${pence < 0n ? "-" : ""}£${new Intl.NumberFormat("en-GB").format(magnitude / 100n)}.${String(magnitude % 100n).padStart(2, "0")}`;
}

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Month labels come from the source "YYYY-MM" string; mid-month noon avoids timezone day shifts.
export function formatMonth(month: string, options: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }): string {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString("en-GB", options);
}

export function financeError(error: unknown, fallback = "PennyPilot could not load or save this financial data."): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
}
