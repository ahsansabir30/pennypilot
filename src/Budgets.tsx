import { useEffect, useState } from "react";
import type { FormEvent, Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { financeError, formatPence, localIsoDate, penceRatio, poundsToPence } from "./finance";
import type { BudgetData, Category } from "./finance";
import Modal from "./Modal";
import BudgetTransactions from "./BudgetTransactions";

export default function Budgets({ month, categories, refreshKey, onChanged, headingRef }: {
  month: string; categories: Category[]; refreshKey: number; onChanged?: () => void; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const [result, setResult] = useState<{ key: string; data: BudgetData | null; error: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ categoryId: "", limit: "" });
  const [deleting, setDeleting] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [transactionCategory, setTransactionCategory] = useState<{ id: number; key: string } | null>(null);
  const eligible = categories.filter((category) => category.categoryType === "expense");
  const requestKey = `${month}:${refreshKey}:${revision}`;
  const current = result?.key === requestKey && result.data?.month === month ? result.data : null;
  const transactionRow = transactionCategory?.key === requestKey
    ? current?.rows.find((row) => row.categoryId === transactionCategory.id) : undefined;
  const loadError = result?.key === requestKey ? result.error : "";
  const displayedError = error || loadError;

  useEffect(() => {
    let active = true;
    invoke<BudgetData>("list_budgets", { month, asOf: localIsoDate() })
      .then((data) => { if (active) setResult({ key: requestKey, data, error: "" }); })
      .catch((error: unknown) => { if (active) setResult({ key: requestKey, data: null, error: financeError(error) }); });
    return () => { active = false; };
  }, [month, refreshKey, revision, requestKey]);

  async function mutate(command: string, args: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await invoke(command, args);
      setMessage(success); setDeleting(null);
      setRevision((value) => value + 1);
      onChanged?.();
      return true;
    } catch (error) {
      setError(financeError(error));
      return false;
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limitPence = poundsToPence(form.limit);
    if (limitPence === null || limitPence <= 0 || !form.categoryId) {
      setError("Choose an expense category and a positive GBP limit with at most two decimal places.");
      return;
    }
    if (await mutate("save_budget", { input: { month, categoryId: Number(form.categoryId), limitPence } },
      `Budget saved for ${month}.`)) {
      setForm({ categoryId: "", limit: "" });
      setEditing(false);
      setShowForm(false);
    }
  }

  return <section id="budgets-panel" className="panel finance-management" aria-label="Monthly category budgets">
    <div className="management-heading">
    <h2 id="budgets-title" ref={headingRef} tabIndex={-1}>Monthly limits</h2>
    <button className="add-transaction-button" type="button" disabled={busy || eligible.length === 0} onClick={() => {
      setForm({ categoryId: "", limit: "" }); setEditing(false); setError(""); setShowForm(true);
    }}>Add budget</button>
    </div>
    {displayedError && !showForm && <div role="alert">{displayedError} <button type="button" onClick={() => { setError(""); setRevision((value) => value + 1); }}>Retry budgets</button></div>}
    {message && <p role="status">{message}</p>}
    {!current && !displayedError && <p role="status">Loading budgets...</p>}
    {current && <>
      {current.rows.length === 0 && <p>No budgets this month.</p>}
      <ul className="budget-list" aria-label="Category budgets">
        {current.rows.map((row) => {
          const used = BigInt(row.usedPence);
          const limit = BigInt(row.limitPence);
          const percent = penceRatio(used > 0n ? used : 0n, limit) * 100;
          const exceeded = used > limit;
          const status = exceeded ? "Exceeded budget" : row.recordCount === 0 ? "No records yet" : used * 100n >= limit * 80n ? "Approaching limit" : "Within limit";
          return <li className="budget-row" key={row.categoryId}>
            <div className="budget-row-main">
              <div className="budget-row-title">
                <span className="budget-category-dot" aria-hidden="true"
                  style={{ backgroundColor: categories.find((category) => category.id === row.categoryId)?.color }} />
                <h3>{row.categoryName}</h3>
              </div>
              <p>{formatPence(row.usedPence)} used / {formatPence(row.limitPence)} limit</p>
            </div>
            <div className="budget-row-usage">
              <progress className={exceeded ? "over" : undefined} aria-label={`${row.categoryName} budget progress`} value={Math.min(100, percent)} max={100} />
              <p className={exceeded ? "budget-exceeded" : ""}>{status} · {(Math.round(percent * 10) / 10).toFixed(1)}%</p>
            </div>
            <div className="budget-row-remaining">
              <p>{exceeded ? `${formatPence(used - limit)} over limit.`
                : `${formatPence(limit - used)} remaining allowance.`}</p>
            </div>
            <div className="budget-row-actions">
              <button type="button" aria-label={`View transactions for ${row.categoryName}`} disabled={busy}
                onClick={() => setTransactionCategory({ id: row.categoryId, key: requestKey })}>Transactions</button>
              <button type="button" aria-label={`Edit budget for ${row.categoryName}`} disabled={busy} onClick={() => {
                setForm({ categoryId: String(row.categoryId), limit: (row.limitPence / 100).toFixed(2) });
                setEditing(true); setError(""); setMessage("");
                setShowForm(true);
              }}>Edit</button>
              <button className="budget-remove" type="button" aria-label={`Remove budget for ${row.categoryName}`} disabled={busy} onClick={() => setDeleting(row.categoryId)}>Remove</button>
            </div>
          </li>;
        })}
      </ul>
    </>}
    {deleting !== null && <div role="group" aria-label="Confirm budget removal">
      Remove the limit for {month}? Transactions are retained.
      <button type="button" disabled={busy} onClick={() => void mutate("delete_budget", { month, categoryId: deleting }, "Budget removed.")}>Confirm budget removal</button>
      <button type="button" disabled={busy} onClick={() => setDeleting(null)}>Cancel budget removal</button>
    </div>}
    {current && transactionRow &&
      <BudgetTransactions key={`${requestKey}:${transactionRow.categoryId}`} month={month} categoryId={transactionRow.categoryId}
        categoryName={transactionRow.categoryName}
        periodEnd={current.periodEnd} refreshKey={requestKey} onClose={() => setTransactionCategory(null)} />}
    {showForm && <Modal title={editing ? "Edit budget limit" : "Add budget"} busy={busy} onClose={() => { setShowForm(false); setError(""); }}>
    {displayedError && <p role="alert">{displayedError}</p>}
    <form className="transaction-form budget-limit-form" onSubmit={(event) => void save(event)}>
      <div className="budget-editor-heading">
        <span>{month}</span>
      </div>
      <div className="transaction-form-grid budget-limit-fields">
        <label>Budget category<select required disabled={busy} value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.currentTarget.value })}>
          <option value="">Choose an expense category</option>
          {eligible.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <div className="budget-amount-field"><label htmlFor="budget-limit">Monthly limit (GBP)</label><span className="budget-amount-input">
          <span aria-hidden="true">£</span>
          <input id="budget-limit" data-modal-focus={editing ? true : undefined} required disabled={busy} inputMode="decimal" placeholder="0.00" value={form.limit}
            onChange={(event) => setForm({ ...form, limit: event.currentTarget.value })} />
        </span></div>
      </div>
      <div className="modal-actions">
        <button type="submit" aria-label="Save monthly budget" disabled={busy || eligible.length === 0}>Save</button>
        <button type="button" aria-label="Cancel budget" disabled={busy} onClick={() => {
          setForm({ categoryId: "", limit: "" }); setEditing(false); setError(""); setMessage("");
          setShowForm(false);
        }}>Cancel</button>
      </div>
    </form></Modal>}
  </section>;
}
