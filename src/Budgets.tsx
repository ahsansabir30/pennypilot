import { useEffect, useState } from "react";
import type { FormEvent, Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { financeError, formatPence, localIsoDate, poundsToPence } from "./finance";
import type { BudgetData, Category } from "./finance";

export default function Budgets({ month, categories, refreshKey, onChanged, headingRef }: {
  month: string; categories: Category[]; refreshKey: number; onChanged?: () => void; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ categoryId: "", limit: "" });
  const [deleting, setDeleting] = useState<number | null>(null);
  const eligible = categories.filter((category) => category.categoryType === "expense");
  const current = data?.month === month ? data : null;

  useEffect(() => {
    let active = true;
    invoke<BudgetData>("list_budgets", { month, asOf: localIsoDate() })
      .then((result) => { if (active) { setData(result); setError(""); } })
      .catch((error: unknown) => { if (active) setError(financeError(error)); });
    return () => { active = false; };
  }, [month, refreshKey, revision]);

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
      `Budget saved for ${month}.`)) setForm({ categoryId: "", limit: "" });
  }

  return <section id="budgets-panel" className="panel finance-management" aria-labelledby="budgets-title">
    <h2 id="budgets-title" ref={headingRef} tabIndex={-1}>Monthly category budgets</h2>
    <p className="policy-note">{month} only. Expenses less refunds; transfers excluded. Recorded history may be incomplete.</p>
    {error && <div role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry budgets</button></div>}
    {message && <p role="status">{message}</p>}
    {!current && !error && <p role="status">Loading budgets...</p>}
    {current && <>
      <details className="calculation-details"><summary>Period details</summary><p className="policy-note">As of {current.asOf}: {current.periodEnd
        ? `current period ${month}-01 through ${current.periodEnd}`
        : "future month; no elapsed period"}.
        {current.previousEnd && ` Comparison: ${current.previousMonth}-01 through ${current.previousEnd}.`}
        {" "}Missing records are not treated as evidence of no spending. No projections.</p></details>
      <label className="management-preference">Comparison period
        <select aria-label="Comparison period" disabled={busy} value={current.comparisonMode}
          onChange={(event) => void mutate("save_budget_preferences", { comparisonMode: event.currentTarget.value }, "Comparison preference saved.")}>
          <option value="same_day">Same elapsed days</option>
          <option value="full_month">Full previous month (unequal periods)</option>
        </select>
      </label>
      {current.rows.length === 0 && <p>No budgets this month.</p>}
      <ul className="management-cards">
        {current.rows.map((row) => {
          const percent = Math.max(0, row.usedPence) / row.limitPence * 100;
          const exceeded = row.usedPence > row.limitPence;
          const status = exceeded ? "Exceeded budget" : row.recordCount === 0 ? "No records yet" : percent >= 80 ? "Approaching limit" : "Within limit";
          return <li key={row.categoryId}>
            <h3>{row.categoryName}</h3>
            <p>{formatPence(row.usedPence)} used / {formatPence(row.limitPence)} limit</p>
            <progress className={exceeded ? "over" : undefined} aria-label={`${row.categoryName} budget progress`} value={Math.min(100, percent)} max={100} />
            <p className={exceeded ? "budget-exceeded" : ""}>{status} · {(Math.round(percent * 10) / 10).toFixed(1)}%</p>
            <p>{exceeded ? `${formatPence(row.usedPence - row.limitPence)} over limit.`
              : `${formatPence(row.limitPence - row.usedPence)} remaining allowance.`}</p>
            <details className="calculation-details"><summary>Calculation details</summary><p className="policy-note">{row.recordCount} expense/refund records in this period.
              {row.usedPence < 0 && " Refunds exceed expenses; the progress bar is floored at zero, not the recorded used amount."}</p>
            <p className="policy-note">{row.previousUsedPence === null
              ? "No comparable category records in the previous period; no change inferred."
              : `Previous recorded net spending: ${formatPence(row.previousUsedPence)} from ${row.previousRecordCount} records.${row.recordCount > 0 ? ` Recorded change: ${formatPence(row.usedPence - row.previousUsedPence)}.` : " No current records for a change comparison."}`}</p>
            {row.recordCount === 0 && <p className="policy-note">No current category records; zero recorded usage is not evidence of zero actual spending.</p>}</details>
            <button type="button" disabled={busy} onClick={() => setForm({ categoryId: String(row.categoryId), limit: (row.limitPence / 100).toFixed(2) })}>Edit budget for {row.categoryName}</button>
            <button type="button" disabled={busy} onClick={() => setDeleting(row.categoryId)}>Remove budget for {row.categoryName}</button>
          </li>;
        })}
      </ul>
    </>}
    {deleting !== null && <div role="group" aria-label="Confirm budget removal">
      Remove the limit for {month}? Transactions are retained.
      <button type="button" disabled={busy} onClick={() => void mutate("delete_budget", { month, categoryId: deleting }, "Budget removed.")}>Confirm budget removal</button>
      <button type="button" disabled={busy} onClick={() => setDeleting(null)}>Cancel budget removal</button>
    </div>}
    <form className="transaction-form" onSubmit={(event) => void save(event)}>
      <h3>Budget limit · {month}</h3>
      <div className="transaction-form-grid">
        <label>Budget category<select required disabled={busy} value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.currentTarget.value })}>
          <option value="">Choose an expense category</option>
          {eligible.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <label>Monthly limit (GBP)<input required disabled={busy} inputMode="decimal" value={form.limit}
          onChange={(event) => setForm({ ...form, limit: event.currentTarget.value })} /></label>
      </div>
      <button type="submit" disabled={busy || eligible.length === 0}>Save monthly budget</button>
      {(form.categoryId || form.limit) && <button type="button" disabled={busy} onClick={() => {
        setForm({ categoryId: "", limit: "" }); setError(""); setMessage("");
      }}>Clear budget form</button>}
    </form>
  </section>;
}
