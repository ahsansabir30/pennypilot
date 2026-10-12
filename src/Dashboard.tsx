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
import { useWorkspacePage, workspacePages } from "./navigation";
import Modal from "./Modal";

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
  const activePage = useWorkspacePage();
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const pageLabel = workspacePages.find((item) => item.id === activePage)!.label;
  const [month, setMonth] = useState(currentMonth);
  const [financeResult, setFinanceResult] = useState<{ key: string; data: FinanceData | null; error: string } | null>(null);
  const [transactionResult, setTransactionResult] = useState<{ key: string; data: TransactionPage | null; error: string } | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [planningRevision, setPlanningRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const showBudgets = activePage === "budgets";
  const showGoals = activePage === "savings";
  const showPrivateData = activePage === "backup";
  const showSettings = activePage === "categories";
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [transactionActionError, setTransactionActionError] = useState("");
  const [categoryEditor, setCategoryEditor] = useState<{ transaction: Transaction; choice: string } | null>(null);
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
  const financeKey = `${month}:${refreshKey}`;
  const transactionKey = JSON.stringify([month, kindFilter, categoryFilter, search, sort, page, refreshKey]);
  const finance = financeResult?.data;
  const currentFinance = financeResult?.key === financeKey && !financeResult.error && finance?.summary.month === month ? finance : null;
  const financeError = financeResult?.key === financeKey ? financeResult.error : "";
  const transactions = transactionResult?.key === transactionKey ? transactionResult.data : null;
  const transactionError = transactionActionError || (transactionResult?.key === transactionKey ? transactionResult.error : "");

  useEffect(() => {
    pageHeadingRef.current?.focus();
  }, [activePage]);

  useEffect(() => {
    let active = true;
    void invoke<FinanceData>("list_finance_data", { month })
      .then((data) => {
        if (active) {
          setFinanceResult({ key: financeKey, data, error: "" });
          setForm((current) => ({
            ...current,
            accountId: current.accountId || (data.accounts[0] ? String(data.accounts[0].id) : ""),
          }));
        }
      })
      .catch((error: unknown) => {
        if (active) setFinanceResult((previous) => ({ key: financeKey, data: previous?.data ?? null, error: errorMessage(error) }));
      });
    return () => {
      active = false;
    };
  }, [month, refreshKey, financeKey]);

  useEffect(() => {
    if (activePage !== "transactions") return;
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
          const lastPage = Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1);
          if (page > lastPage) {
            setPage(lastPage);
            return;
          }
          setTransactionResult({ key: transactionKey, data, error: "" });
        }
      })
      .catch((error: unknown) => {
        if (active) setTransactionResult({ key: transactionKey, data: null, error: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [activePage, month, kindFilter, categoryFilter, search, sort, page, refreshKey, transactionKey]);

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
    setTransactionActionError("");
    setRefreshKey((key) => key + 1);
  }

  function restored() {
    setShowForm(false);
    setSearch(""); setKindFilter(""); setCategoryFilter(""); setPage(0); setPendingDelete(null);
    setTransactionResult(null);
    setTransactionActionError("");
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
    setTransactionActionError("");
    setBusy(true);
    try {
      await invoke("update_transaction_category", {
        transactionId,
        categoryId: categoryId ? Number(categoryId) : null,
      });
      setCategoryEditor(null);
      refresh();
    } catch (error) {
      setTransactionActionError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function clearManualCategory(transactionId: number) {
    setTransactionActionError("");
    setBusy(true);
    try {
      await invoke("reset_transaction_category", { transactionId });
      setCategoryEditor(null);
      refresh();
    } catch (error) {
      setTransactionActionError(errorMessage(error));
    } finally { setBusy(false); }
  }

  async function deleteTransaction(transactionId: number) {
    setTransactionActionError("");
    setBusy(true);
    try {
      await invoke("delete_transaction", { transactionId });
      setPendingDelete(null);
      refresh();
    } catch (error) {
      setTransactionActionError(errorMessage(error));
    } finally { setBusy(false); }
  }

  function changeKind(kind: TransactionKind) {
    setForm((current) => ({
      ...current,
      kind,
      categoryId: "",
    }));
  }

  const monthly = currentFinance?.summary;
  const historyMaximum = (currentFinance?.history.flatMap((item) => [BigInt(item.incomePence), BigInt(item.expensePence)]) ?? [])
    .reduce((maximum, amount) => amount > maximum ? amount : maximum, 1n);
  const categoryMaximum = (currentFinance?.categorySpending.map((item) => absolutePence(BigInt(item.amountPence))) ?? [])
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
      <nav className="workspace-navigation" aria-label="Workspace pages">
        {workspacePages.map((item) => <a key={item.id} href={`#/${item.id}`}
          aria-current={activePage === item.id ? "page" : undefined}>{item.label}</a>)}
      </nav>

      <div className="dashboard-content">
          <div className="dashboard-heading">
            <h1 id="dashboard-title" ref={pageHeadingRef} tabIndex={-1}>{pageLabel}</h1>
            {["overview", "transactions", "budgets", "backup"].includes(activePage) && <label className="month-picker">
              <span>Month</span>
              <input aria-label="Dashboard month" type="month" value={month}
                onChange={(event) => { setMonth(event.currentTarget.value || currentMonth()); setPage(0); }} />
            </label>}
          </div>
      {!finance && !financeError ? (
        <div className="dashboard-loading" role="status">
          <span className="spinner" />
          Loading your encrypted financial data…
        </div>
      ) : (
        <>

          {!categoryEditor && (financeError || (activePage === "transactions" && transactionError)) && (
            <div className="dashboard-error" role="alert">
              <span>{financeError || transactionError}</span>
              <button className="text-button" onClick={refresh} type="button">Retry</button>
            </div>
          )}

          {!currentFinance && !financeError && finance && <p role="status">Loading financial summary...</p>}
          {finance && (
            <>
              {activePage === "overview" && monthly && <>
              <section className="summary-grid" aria-label={`${month} financial summary`}>
                <SummaryCard
                  label="Income"
                  amount={monthly.incomePence}
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
                  tone={BigInt(monthly.netCashFlowPence) < 0n ? "negative" : "net"}
                />
              </section>
              <p className="policy-note">Recorded activity · GBP. Net cash flow is not an account balance.</p>
              </>}
              {activePage === "overview" && <FinancialHighlights month={month} refreshKey={refreshKey + planningRevision} />}
              <fieldset className="finance-record-controls" disabled={!currentFinance}>
              {showBudgets && <Budgets month={month} categories={finance.categories} refreshKey={refreshKey}
                onChanged={() => setPlanningRevision((value) => value + 1)} />}
              {showGoals && <SavingsGoals onChanged={() => setPlanningRevision((value) => value + 1)} />}
              {showPrivateData && <PrivateData key={month} month={month} accounts={finance.accounts} categories={finance.categories}
                search={search} kind={kindFilter} categoryId={categoryFilter} onRestored={restored} />}
              {showSettings && <CategorisationSettings categories={finance.categories} onChanged={refresh} />}
              </fieldset>

              {activePage === "overview" && currentFinance && monthly && <section className="insight-grid">
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
                  {currentFinance.history.length < 6 && <p className="policy-note">History before January 1000 is unavailable; only supported months are shown.</p>}
                  <div className="trend-chart" role="img" aria-label={currentFinance.history.length < 6 ? "Available income and spending trend" : "Six-month income and spending trend"}>
                    {currentFinance.history.map((item) => (
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
                    {currentFinance.history.map((item) => (
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
                  {currentFinance.categorySpending.length === 0 ? (
                    <p className="empty-chart">No spending recorded for this month yet.</p>
                  ) : (
                    <ul className="category-list">
                      {currentFinance.categorySpending.map((item) => (
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
              </section>}

              {activePage === "overview" && <div className="overview-activity panel">
                <h2>Recorded transactions</h2>
                <a className="lock-button" href="#/transactions">View transactions</a>
              </div>}
              {activePage === "transactions" && <section className="panel transactions-panel" aria-labelledby="dashboard-title">
                <div className="management-heading">
                  <h2>Recorded transactions</h2>
                  <button className="add-transaction-button" disabled={busy || !currentFinance} onClick={openForm} type="button">
                    <span aria-hidden="true">＋</span> Add transaction
                  </button>
                </div>

                {showForm && (
                  <Modal title="Add transaction" busy={busy} onClose={() => setShowForm(false)}>
                  <fieldset className="finance-record-controls" disabled={busy || !currentFinance}>
                  <form className="transaction-form" onSubmit={createTransaction}>
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
                    <div className="modal-actions">
                    <button className="add-transaction-button" disabled={busy} type="submit">
                      {busy ? "Saving…" : "Save transaction"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setShowForm(false)}>Cancel transaction</button>
                    </div>
                  </form>
                  </fieldset></Modal>
                )}
                {categoryEditor && <Modal title="Edit transaction category" busy={busy} onClose={() => { setCategoryEditor(null); setTransactionActionError(""); }}>
                  <p className="category-editor-merchant">{categoryEditor.transaction.merchant || categoryEditor.transaction.description}</p>
                  {(transactionError || financeError) && <p role="alert">{transactionError || financeError}</p>}
                  <form className="transaction-form category-editor-form" onSubmit={(event) => {
                    event.preventDefault();
                    void updateCategory(categoryEditor.transaction.id, categoryEditor.choice);
                  }}>
                    <label className="category-editor-field"><span>Category</span>
                      <select disabled={busy || !currentFinance}
                        aria-label={`Category for ${categoryEditor.transaction.merchant || categoryEditor.transaction.description}`}
                        value={categoryEditor.choice} onChange={(event) => setCategoryEditor({ ...categoryEditor, choice: event.currentTarget.value })}>
                        <option value="">Uncategorised</option>
                        {finance.categories.filter((category) => category.categoryType === (categoryEditor.transaction.kind === "income" ? "income" : "expense"))
                          .map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select>
                    </label>
                    <div className="modal-actions">
                      <button className="add-transaction-button" type="submit" aria-label="Save category choice" disabled={busy || !currentFinance}>Save</button>
                      {categoryEditor.transaction.categorySource === "manual" && <button type="button" disabled={busy || !currentFinance}
                        aria-label={`Use rules for ${categoryEditor.transaction.merchant || categoryEditor.transaction.description}`}
                        onClick={() => void clearManualCategory(categoryEditor.transaction.id)}>Use rules</button>}
                      <button type="button" aria-label="Cancel category choice" disabled={busy} onClick={() => { setCategoryEditor(null); setTransactionActionError(""); }}>Cancel</button>
                    </div>
                  </form>
                </Modal>}

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
                          busy={busy || !currentFinance}
                          onEditCategory={() => { setTransactionActionError(""); setCategoryEditor({ transaction, choice: String(transaction.categoryId ?? "") }); }}
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
              </section>}
            </>
          )}
        </>
      )}
      </div>

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
  description?: string;
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
      {description && <span>{description}</span>}
    </article>
  );
}

function TransactionRow({
  transaction,
  categories,
  pendingDelete,
  busy,
  onEditCategory,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  transaction: Transaction;
  categories: FinanceData["categories"];
  pendingDelete: boolean;
  busy: boolean;
  onEditCategory: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
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
          <div className="category-control">
          <button type="button"
            disabled={busy}
            aria-label={`Edit category for ${displayName}`}
            aria-haspopup="dialog"
            className="category-select"
            onClick={onEditCategory}
          >
            {transaction.categoryName ?? "Uncategorised"}
          </button>
          {transaction.categoryExplanation.startsWith("Conflict:") && <div className="category-control-meta">
            <details className="category-details">
              <summary>
                <span>Category conflict</span>
              </summary>
              <small className="category-explanation">{transaction.categoryExplanation}</small>
            </details>
          </div>}
          </div>
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
