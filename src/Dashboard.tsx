import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  formatPence,
  absolutePence,
  localIsoDate,
  penceRatio,
  poundsToPence,
} from "./finance";
import type {
  FinanceData,
  Transaction,
  TransactionKind,
  TransactionPage,
} from "./finance";
import "./Dashboard.css";
import CategorisationSettings from "./CategorisationSettings";
import Budgets from "./Budgets";
import SavingsGoals from "./SavingsGoals";
import PrivateData from "./PrivateData";
import FinancialHighlights from "./FinancialHighlights";

const PAGE_SIZE = 10;

type Props = {
  onLock: () => void;
  lockBusy?: boolean;
  lockError?: string;
};

function currentMonth(): string {
  return localIsoDate().slice(0, 7);
}

function Dashboard({ onLock, lockBusy = false, lockError = "" }: Props) {
  const [month, setMonth] = useState(currentMonth);
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [transactions, setTransactions] = useState<TransactionPage | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [planningRevision, setPlanningRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activePanel, setActivePanel] = useState<"budgets" | "goals" | "private" | "categories" | null>(null);
  const showBudgets = activePanel === "budgets";
  const showGoals = activePanel === "goals";
  const showPrivateData = activePanel === "private";
  const showSettings = activePanel === "categories";
  const budgetHeadingRef = useRef<HTMLHeadingElement>(null);
  const goalHeadingRef = useRef<HTMLHeadingElement>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [financeError, setFinanceError] = useState("");
  const [transactionError, setTransactionError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [form, setForm] = useState({
    accountId: "",
    categoryId: "",
    amount: "",
    kind: "expense" as TransactionKind,
    transactionDate: localIsoDate(),
    description: "",
    merchant: "",
  });

  useEffect(() => { if (showBudgets) budgetHeadingRef.current?.focus(); }, [showBudgets]);
  useEffect(() => { if (showGoals) goalHeadingRef.current?.focus(); }, [showGoals]);

  useEffect(() => {
    let active = true;
    void invoke<FinanceData>("list_finance_data", { month })
      .then((data) => {
        if (active) {
          setFinance(data);
          setForm((current) => ({
            ...current,
            accountId: current.accountId || (data.accounts[0] ? String(data.accounts[0].id) : ""),
          }));
          setFinanceError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setFinanceError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, refreshKey]);

  useEffect(() => {
    let active = true;
    void invoke<TransactionPage>("list_transactions", {
      filter: {
        month,
        kind: kindFilter || null,
        categoryId: categoryFilter ? Number(categoryFilter) : null,
        search,
        sort,
        page,
        pageSize: PAGE_SIZE,
      },
    })
      .then((data) => {
        if (active) {
          setTransactions(data);
          setTransactionError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setTransactionError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [month, kindFilter, categoryFilter, search, sort, page, refreshKey]);

  const filteredCategories = useMemo(
    () =>
      finance?.categories.filter((category) =>
        form.kind === "income"
          ? category.categoryType === "income"
          : category.categoryType === "expense",
      ) ?? [],
    [finance?.categories, form.kind],
  );

  function refresh() {
    setRefreshKey((key) => key + 1);
  }

  function openPlanning(panel: "budgets" | "goals") {
    if (activePanel === panel) {
      (panel === "budgets" ? budgetHeadingRef : goalHeadingRef).current?.focus();
    } else {
      setActivePanel(panel);
    }
  }

  function togglePanel(panel: NonNullable<typeof activePanel>) {
    setActivePanel((current) => current === panel ? null : panel);
  }

  function restored() {
    setActivePanel("private"); setShowForm(false);
    setSearch(""); setKindFilter(""); setCategoryFilter(""); setPage(0); setPendingDelete(null);
    setTransactions(null);
    refresh();
  }

  function resetForm() {
    setForm({
      accountId: finance?.accounts[0] ? String(finance.accounts[0].id) : "",
      categoryId: "",
      amount: "",
      kind: "expense",
      transactionDate: localIsoDate(),
      description: "",
      merchant: "",
    });
    setFormMessage("");
  }

  function openForm() {
    resetForm();
    setShowForm(true);
  }

  async function createTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage("");
    const amountPence = poundsToPence(form.amount);
    if (amountPence === null || amountPence <= 0) {
      setFormMessage("Enter an amount in pounds with up to two decimal places.");
      return;
    }
    setBusy(true);
    try {
      await invoke("create_transaction", {
        input: {
          accountId: Number(form.accountId),
          categoryId: form.kind === "transfer" || !form.categoryId || form.categoryId === "uncategorised"
            ? null : Number(form.categoryId),
          manualCategory: form.kind !== "transfer" && form.categoryId !== "",
          amountPence,
          kind: form.kind,
          transactionDate: form.transactionDate,
          description: form.description,
          merchant: form.merchant.trim() || null,
        },
      });
      setShowForm(false);
      setMonth(form.transactionDate.slice(0, 7));
      setPage(0);
      refresh();
    } catch (error) {
      setFormMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateCategory(transactionId: number, categoryId: string) {
    setTransactionError("");
    setBusy(true);
    try {
      await invoke("update_transaction_category", {
        transactionId,
        categoryId: categoryId ? Number(categoryId) : null,
      });
      refresh();
    } catch (error) {
      setTransactionError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function clearManualCategory(transactionId: number) {
    setTransactionError("");
    setBusy(true);
    try {
      await invoke("reset_transaction_category", { transactionId });
      refresh();
    } catch (error) {
      setTransactionError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function deleteTransaction(transactionId: number) {
    setTransactionError("");
    setBusy(true);
    try {
      await invoke("delete_transaction", { transactionId });
      setPendingDelete(null);
      refresh();
    } catch (error) {
      setTransactionError(errorMessage(error));
    } finally { setBusy(false); }
  }

  function changeKind(kind: TransactionKind) {
    setForm((current) => ({
      ...current,
      kind,
      categoryId: "",
    }));
  }

  const monthly = finance?.summary;
  const historyMaximum = (finance?.history.flatMap((item) => [BigInt(item.incomePence), BigInt(item.expensePence)]) ?? [])
    .reduce((maximum, amount) => amount > maximum ? amount : maximum, 1n);
  const categoryMaximum = (finance?.categorySpending.map((item) => absolutePence(BigInt(item.amountPence))) ?? [])
    .reduce((maximum, amount) => amount > maximum ? amount : maximum, 1n);

  return (
    <main className="app-shell finance-shell">
      <header className="topbar dashboard-topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">p</span>
          <span>PennyPilot</span>
        </div>
        <div className="dashboard-actions">
          <span className="privacy-pill">
            <span className="privacy-dot" />
            Encrypted on this device
          </span>
          <button className="lock-button" disabled={lockBusy} onClick={onLock} type="button">
            {lockBusy ? "Locking..." : "Lock workspace"}
          </button>
        </div>
      </header>
      {lockError && <p className="dashboard-error" role="alert">{lockError}</p>}

      {loading && !finance ? (
        <div className="dashboard-loading" role="status">
          <span className="spinner" />
          Loading your encrypted financial data…
        </div>
      ) : (
        <section className="dashboard-content" aria-labelledby="dashboard-title">
          <div className="dashboard-heading">
            <div>
              <h1 id="dashboard-title">Financial overview</h1>
              <p>Recorded activity · GBP</p>
            </div>
            <label className="month-picker">
              <span>Month</span>
              <input
                aria-label="Dashboard month"
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.currentTarget.value || currentMonth());
                  setPage(0);
                }}
              />
            </label>
          </div>

          {(financeError || transactionError) && (
            <div className="dashboard-error" role="alert">
              <span>{financeError || transactionError}</span>
              <button className="text-button" onClick={refresh} type="button">Retry</button>
            </div>
          )}

          {monthly && finance && (
            <>
              <section className="summary-grid" aria-label={`${month} financial summary`}>
                <SummaryCard
                  label="Income"
                  amount={monthly.incomePence}
                  description="Income received"
                  tone="income"
                />
                <SummaryCard
                  label="Spending"
                  amount={monthly.expensePence}
                  description="Expenses less refunds"
                  tone="spending"
                />
                <SummaryCard
                  label="Net cash flow"
                  amount={monthly.netCashFlowPence}
                  description="Income less net spending"
                  tone={BigInt(monthly.netCashFlowPence) < 0n ? "negative" : "net"}
                />
              </section>
              <p className="policy-note">Net cash flow is not an account balance.</p>
              <nav className="finance-tools" aria-label="Workspace tools">
                <a className="lock-button" href="#transactions-title">Transactions</a>
                <button className="lock-button" type="button" aria-expanded={showBudgets}
                  aria-controls="budgets-panel" aria-label="Monthly budgets and insights" onClick={() => togglePanel("budgets")}>Budgets</button>
                <button className="lock-button" type="button" aria-expanded={showGoals}
                  aria-controls="savings-panel" aria-label="Manage savings goals" onClick={() => togglePanel("goals")}>Savings</button>
                <button className="lock-button" type="button" aria-expanded={showPrivateData}
                  aria-controls="private-data-panel" aria-label="Private export and backup" onClick={() => togglePanel("private")}>Export &amp; backup</button>
              </nav>
              <FinancialHighlights month={month} refreshKey={refreshKey + planningRevision}
                onBudgets={() => openPlanning("budgets")} onGoals={() => openPlanning("goals")} />
              {showBudgets && <Budgets month={month} categories={finance.categories} refreshKey={refreshKey}
                headingRef={budgetHeadingRef} onChanged={() => setPlanningRevision((value) => value + 1)} />}
              {showGoals && <SavingsGoals headingRef={goalHeadingRef} onChanged={() => setPlanningRevision((value) => value + 1)} />}
              {showPrivateData && <PrivateData key={month} month={month} accounts={finance.accounts} categories={finance.categories}
                search={search} kind={kindFilter} categoryId={categoryFilter} onRestored={restored} />}

              <section className="insight-grid">
                <article className="panel trend-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Monthly trend</h2>
                      <p>Income and net spending · GBP</p>
                    </div>
                    <span className="chart-legend">
                      <i className="legend-income" /> Income
                      <i className="legend-spending" /> Spending
                    </span>
                  </div>
                  {finance.history.length < 6 && <p className="policy-note">History before January 1000 is unavailable; only supported months are shown.</p>}
                  <div className="trend-chart" role="img" aria-label={finance.history.length < 6 ? "Available income and spending trend" : "Six-month income and spending trend"}>
                    {finance.history.map((item) => (
                      <div className="trend-month" key={item.month}>
                        <div className="trend-bars">
                          <div
                            className="trend-bar income-bar"
                            style={{ height: `${Math.max(2, penceRatio(BigInt(item.incomePence), historyMaximum) * 100)}%` }}
                            title={`Income ${formatPence(item.incomePence)}`}
                          />
                          <div
                            className="trend-bar spending-bar"
                            style={{ height: `${Math.max(2, penceRatio(BigInt(item.expensePence), historyMaximum) * 100)}%` }}
                            title={`Net spending ${formatPence(item.expensePence)}`}
                          />
                        </div>
                        <span>{new Date(`${item.month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short" })}</span>
                      </div>
                    ))}
                  </div>
                  <div className="trend-values">
                    {finance.history.map((item) => (
                      <span key={item.month}>
                        {new Date(`${item.month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                        <b>Net {formatPence(item.netCashFlowPence)}</b>
                      </span>
                    ))}
                  </div>
                </article>

                <article className="panel category-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Spending by category</h2>
                      <p>Refunds offset their original category</p>
                    </div>
                    <span className="category-total">{formatPence(monthly.expensePence)}</span>
                  </div>
                  {finance.categorySpending.length === 0 ? (
                    <p className="empty-chart">No spending recorded for this month yet.</p>
                  ) : (
                    <ul className="category-list">
                      {finance.categorySpending.map((item) => (
                        <li key={item.categoryId ?? "uncategorised"}>
                          <div className="category-label">
                            <span><i style={{ backgroundColor: item.color }} />{item.categoryName}</span>
                            <b>{formatPence(item.amountPence)}</b>
                          </div>
                          <div className="category-track">
                            <span
                              style={{
                                backgroundColor: item.color,
                                width: `${Math.max(2, penceRatio(absolutePence(BigInt(item.amountPence)), categoryMaximum) * 100)}%`,
                              }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </section>

              <section className="panel transactions-panel" aria-labelledby="transactions-title">
                <div className="transactions-heading">
                  <div>
                    <h2 id="transactions-title" tabIndex={-1}>Transactions</h2>
                  </div>
                  <div className="dashboard-actions">
                  <button className="lock-button" onClick={() => togglePanel("categories")} type="button"
                    aria-controls="categorisation-panel" aria-expanded={showSettings}>Manage categories and rules</button>
                  <button className="add-transaction-button" disabled={busy} onClick={openForm} type="button">
                    <span aria-hidden="true">＋</span> Add transaction
                  </button>
                  </div>
                </div>

                {showForm && (
                  <form className="transaction-form" onSubmit={createTransaction}>
                    <div className="form-title">
                      <h3>Add transaction</h3>
                      <button
                        aria-label="Close transaction form"
                        className="close-form-button"
                        disabled={busy}
                        onClick={() => setShowForm(false)}
                        type="button"
                      >×</button>
                    </div>
                    <div className="transaction-form-grid">
                      <label>
                        Type
                        <select
                          value={form.kind}
                          onChange={(event) => {
                            const kind = event.currentTarget.value;
                            if (isTransactionKind(kind)) changeKind(kind);
                          }}
                        >
                          <option value="expense">Expense</option>
                          <option value="income">Income</option>
                          <option value="refund">Refund</option>
                          <option value="transfer">Transfer</option>
                        </select>
                      </label>
                      <label>
                        Amount (GBP)
                        <input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={form.amount}
                          onChange={(event) => setForm({ ...form, amount: event.currentTarget.value })}
                          required
                        />
                      </label>
                      <label>
                        Transaction date
                        <input
                          type="date"
                          value={form.transactionDate}
                          onChange={(event) => setForm({ ...form, transactionDate: event.currentTarget.value })}
                          required
                        />
                      </label>
                      <label>
                        Account
                        <select
                          value={form.accountId}
                          onChange={(event) => setForm({ ...form, accountId: event.currentTarget.value })}
                          required
                        >
                          {finance.accounts.map((account) => (
                            <option key={account.id} value={account.id}>{account.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Category
                        <select
                          aria-label="Category"
                          disabled={form.kind === "transfer"}
                          value={form.categoryId}
                          onChange={(event) => setForm({ ...form, categoryId: event.currentTarget.value })}
                        >
                          <option value="">Automatic (use merchant rules)</option>
                          <option value="uncategorised">Uncategorised (manual choice)</option>
                          {filteredCategories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                        <span className="policy-note">Explicit choices are protected from rule changes.</span>
                      </label>
                      <label>
                        Description
                        <input
                          maxLength={200}
                          value={form.description}
                          onChange={(event) => setForm({ ...form, description: event.currentTarget.value })}
                          required
                        />
                      </label>
                      <label className="merchant-field">
                        Merchant <span>optional</span>
                        <input
                          maxLength={120}
                          value={form.merchant}
                          onChange={(event) => setForm({ ...form, merchant: event.currentTarget.value })}
                        />
                      </label>
                    </div>
                    {form.kind === "refund" && (
                      <p className="policy-note">Refunds reduce spending in the selected category and count as a cash inflow.</p>
                    )}
                    {form.kind === "transfer" && (
                      <p className="policy-note">Transfers are recorded but excluded from income and spending totals.</p>
                    )}
                    {formMessage && <p className="form-message error" role="alert">{formMessage}</p>}
                    <button className="add-transaction-button form-submit" disabled={busy} type="submit">
                      {busy ? "Saving…" : "Save transaction"}
                    </button>
                  </form>
                )}

                <div className="transaction-filters">
                  <label className="search-field">
                    <span className="sr-only">Search transactions</span>
                    <span aria-hidden="true">⌕</span>
                    <input
                      placeholder="Search merchant or description"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.currentTarget.value);
                        setPage(0);
                      }}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Filter by transaction type</span>
                    <select
                      aria-label="Filter by type"
                      value={kindFilter}
                      onChange={(event) => {
                        setKindFilter(event.currentTarget.value);
                        setPage(0);
                      }}
                    >
                      <option value="">All types</option>
                      <option value="income">Income</option>
                      <option value="expense">Expense</option>
                      <option value="refund">Refund</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Filter by category</span>
                    <select
                      aria-label="Filter by category"
                      value={categoryFilter}
                      onChange={(event) => {
                        setCategoryFilter(event.currentTarget.value);
                        setPage(0);
                      }}
                    >
                      <option value="">All categories</option>
                      {finance.categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Sort transactions</span>
                    <select aria-label="Sort transactions" value={sort} onChange={(event) => setSort(event.currentTarget.value)}>
                      <option value="date_desc">Newest first</option>
                      <option value="date_asc">Oldest first</option>
                      <option value="amount_desc">Amount: high to low</option>
                      <option value="amount_asc">Amount: low to high</option>
                      <option value="merchant_asc">Merchant: A to Z</option>
                    </select>
                  </label>
                </div>

                <div className="transaction-table-wrap">
                  <table className="transaction-table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Description</th>
                        <th scope="col">Type</th>
                        <th scope="col">Category</th>
                        <th scope="col" className="amount-column">Amount</th>
                        <th scope="col"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {!transactions && !transactionError && <tr><td className="empty-transactions" colSpan={6}>
                        <span role="status">Loading transactions...</span>
                      </td></tr>}
                      {transactions?.transactions.map((transaction) => (
                        <TransactionRow
                          key={transaction.id}
                          transaction={transaction}
                          categories={finance.categories}
                          pendingDelete={pendingDelete === transaction.id}
                          busy={busy}
                          onCategoryChange={(categoryId) => void updateCategory(transaction.id, categoryId)}
                          onUseRules={() => void clearManualCategory(transaction.id)}
                          onDelete={() => setPendingDelete(transaction.id)}
                          onCancelDelete={() => setPendingDelete(null)}
                          onConfirmDelete={() => void deleteTransaction(transaction.id)}
                        />
                      ))}
                      {transactions?.transactions.length === 0 && (
                        <tr>
                          <td className="empty-transactions" colSpan={6}>
                            <span>{search || kindFilter || categoryFilter
                              ? "No transactions match these filters."
                              : "No transactions this month."}</span>
                            {(search || kindFilter || categoryFilter) && <button className="lock-button clear-filters" type="button"
                              onClick={() => { setSearch(""); setKindFilter(""); setCategoryFilter(""); setPage(0); }}>Clear filters</button>}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pagination">
                  <span>
                    {!transactions
                      ? transactionError ? "Records unavailable" : "Loading records..."
                      : transactions.total === 0
                      ? "No records"
                      : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, transactions?.total ?? 0)} of ${transactions?.total ?? 0}`}
                  </span>
                  <div>
                    <button
                      disabled={!transactions || page === 0}
                      onClick={() => setPage((value) => Math.max(0, value - 1))}
                      type="button"
                    >Previous</button>
                    <button
                      disabled={!transactions || (page + 1) * PAGE_SIZE >= transactions.total}
                      onClick={() => setPage((value) => value + 1)}
                      type="button"
                    >Next</button>
                  </div>
                </div>
                <p className="accounting-policy">
                  Refunds offset spending and are included in net cash flow. Transfers are excluded from income, spending and net cash flow.
                </p>
              </section>
              {showSettings && <CategorisationSettings categories={finance.categories} onChanged={refresh} />}
            </>
          )}
        </section>
      )}

      <footer className="page-footer dashboard-footer">
        <span>Encrypted · Stored locally</span>
        <span>GBP · United Kingdom</span>
      </footer>
    </main>
  );
}

function SummaryCard({
  label,
  amount,
  description,
  tone,
}: {
  label: string;
  amount: string;
  description: string;
  tone: string;
}) {
  return (
    <article className={`summary-card ${tone}`}>
      <div className="summary-card-top">
        <span>{label}</span>
        <span aria-hidden="true" className="summary-card-mark">
          {tone === "income" ? "↗" : tone === "spending" ? "↘" : "±"}
        </span>
      </div>
      <strong>{formatPence(amount)}</strong>
      <span>{description}</span>
    </article>
  );
}

function TransactionRow({
  transaction,
  categories,
  pendingDelete,
  busy,
  onCategoryChange,
  onUseRules,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  transaction: Transaction;
  categories: FinanceData["categories"];
  pendingDelete: boolean;
  busy: boolean;
  onCategoryChange: (categoryId: string) => void;
  onUseRules: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const eligibleCategories = categories.filter((category) =>
    transaction.kind === "income"
      ? category.categoryType === "income"
      : category.categoryType === "expense",
  );
  const signedAmount = transaction.kind === "expense"
    ? -transaction.amountPence
    : transaction.amountPence;
  const displayName = transaction.merchant || transaction.description;
  return (
    <tr>
      <td className="transaction-date">{transaction.transactionDate}</td>
      <td className="transaction-identity">
        <div className="merchant-label">
          <span className="merchant-avatar" aria-hidden="true">{Array.from(displayName.trim())[0]?.toLocaleUpperCase("en-GB") ?? "T"}
            <i className="merchant-category-dot" style={{ backgroundColor: categories.find((category) => category.id === transaction.categoryId)?.color ?? "#7c8880" }} />
          </span>
          <div><strong className="transaction-merchant">{displayName}</strong>
            {transaction.merchant && <span className="transaction-description">{transaction.description}</span>}</div>
        </div>
      </td>
      <td><span className={`kind-badge ${transaction.kind}`}>{transaction.kind}</span></td>
      <td className="transaction-category">
        {transaction.kind === "transfer" ? (
          <span className="transfer-category">Excluded</span>
        ) : (
          <>
          <select
            disabled={busy}
            aria-label={`Category for ${displayName}`}
            className="category-select"
            value={transaction.categorySource === "manual" ? transaction.categoryId ?? "" : "automatic"}
            onChange={(event) => onCategoryChange(event.currentTarget.value)}
          >
            {transaction.categorySource !== "manual" && <option value="automatic" disabled>
              {transaction.categoryName ?? "Uncategorised"} (automatic)
            </option>}
            <option value="">Uncategorised</option>
            {eligibleCategories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          {transaction.categorySource === "manual"
            ? <details className="category-details"><summary>Category details</summary><small className="category-explanation">{transaction.categoryExplanation}</small></details>
            : <small className="category-explanation">{transaction.categoryExplanation}</small>}
          {transaction.categorySource === "manual" && <button type="button"
            className="use-rules-button" disabled={busy} onClick={onUseRules}
            aria-label={`Use rules for ${displayName}`}>Use rules (clear manual choice)</button>}
          </>
        )}
      </td>
      <td className={`amount-column transaction-amount ${transaction.kind}`}>
        {formatPence(signedAmount)}
      </td>
      <td className="transaction-actions">
        {pendingDelete ? (
          <>
            <button className="confirm-delete" disabled={busy} onClick={onConfirmDelete} type="button">Confirm</button>
            <button className="cancel-delete" disabled={busy} onClick={onCancelDelete} type="button">Cancel</button>
          </>
        ) : (
          <button className="delete-button" disabled={busy} onClick={onDelete} type="button" aria-label={`Delete ${displayName}`}>
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "PennyPilot could not load or save this financial data.";
}

function isTransactionKind(value: string): value is TransactionKind {
  return ["income", "expense", "refund", "transfer"].includes(value);
}

export default Dashboard;
