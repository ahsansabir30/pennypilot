import { useEffect, useState } from "react";
import type { FormEvent, Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { financeError, formatPence, poundsToPence } from "./finance";
import type { SavingsGoal } from "./finance";
import Modal from "./Modal";

const empty = { id: null as number | null, name: "", target: "", progress: "0.00", targetDate: "", notes: "" };

export default function SavingsGoals({ onChanged, headingRef }: { onChanged?: () => void; headingRef?: Ref<HTMLHeadingElement> }) {
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [form, setForm] = useState(empty);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let active = true;
    invoke<SavingsGoal[]>("list_savings_goals")
      .then((result) => { if (active) { setGoals(result); setError(""); } })
      .catch((error: unknown) => { if (active) setError(financeError(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  async function mutate(command: string, args: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await invoke(command, args);
      setForm(empty); setDeleting(null); setMessage(success); setRevision((value) => value + 1);
      setShowForm(false);
      onChanged?.();
    } catch (error) { setError(financeError(error)); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetPence = poundsToPence(form.target);
    const progressPence = poundsToPence(form.progress);
    if (targetPence === null || targetPence <= 0 || progressPence === null) {
      setError("Enter a positive target and non-negative progress in GBP, with at most two decimal places.");
      return;
    }
    await mutate("save_savings_goal", { input: {
      id: form.id, name: form.name, targetPence, progressPence, targetDate: form.targetDate || null, notes: form.notes,
    } }, "Savings goal saved.");
  }

  return <section id="savings-panel" className="panel finance-management" aria-label="Savings goals">
    <div className="management-heading">
    <h2 id="savings-title" ref={headingRef} tabIndex={-1}>Your goals</h2>
    <button className="add-transaction-button" type="button" disabled={busy} onClick={() => { setForm(empty); setError(""); setShowForm(true); }}>Add savings goal</button>
    </div>
    <p className="policy-note">Manual progress. No money is moved.</p>
    {error && !showForm && <div role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry goals</button></div>}
    {message && <p role="status">{message}</p>}
    {loading && <p role="status">Loading savings goals...</p>}
    {!loading && goals.length === 0 && !error && <p>No savings goals yet.</p>}
    <ul className="management-cards">
      {goals.map((goal) => {
        const percent = goal.progressPence / goal.targetPence * 100;
        const remaining = Math.max(0, goal.targetPence - goal.progressPence);
        const extra = Math.max(0, goal.progressPence - goal.targetPence);
        return <li key={goal.id}>
          <h3>{goal.name}</h3>
          <p>{formatPence(goal.progressPence)} / {formatPence(goal.targetPence)} target</p>
          <progress aria-label={`${goal.name} savings progress`} value={Math.min(100, percent)} max={100} />
          <p>{(Math.round(percent * 10) / 10).toFixed(1)}% · {formatPence(remaining)} remaining</p>
          {extra > 0 && <p>Overfunded by {formatPence(extra)}; progress is retained.</p>}
          <details className="calculation-details"><summary>Calculation details</summary><p className="policy-note">Entered progress, not a bank balance. No completion predicted. Inputs: entered progress {formatPence(goal.progressPence)} ÷ target {formatPence(goal.targetPence)}.
            {goal.targetDate ? ` Target date: ${goal.targetDate} (your preference, not a forecast).` : " No target date."}</p></details>
          {goal.notes && <details className="calculation-details"><summary>Notes</summary><p className="goal-notes">{goal.notes}</p></details>}
          <div className="management-row-actions">
          <button type="button" aria-label={`Edit goal ${goal.name}`} disabled={busy} onClick={() => { setError(""); setShowForm(true); setForm({
            id: goal.id, name: goal.name, target: (goal.targetPence / 100).toFixed(2), progress: (goal.progressPence / 100).toFixed(2),
            targetDate: goal.targetDate ?? "", notes: goal.notes,
          }); }}>Edit</button>
          <button type="button" className="destructive-action" aria-label={`Delete goal ${goal.name}`} disabled={busy} onClick={() => setDeleting(goal.id)}>Delete</button>
          </div>
        </li>;
      })}
    </ul>
    {deleting !== null && <div role="group" aria-label="Confirm goal deletion">
      Delete this goal? No transactions or actual funds will be changed.
      <button type="button" disabled={busy} onClick={() => void mutate("delete_savings_goal", { goalId: deleting }, "Savings goal deleted.")}>Confirm goal deletion</button>
      <button type="button" disabled={busy} onClick={() => setDeleting(null)}>Cancel goal deletion</button>
    </div>}
    {showForm && <Modal title={form.id === null ? "Add savings goal" : "Edit savings goal"} busy={busy}
      onClose={() => { setShowForm(false); setError(""); }}>
    {error && <p role="alert">{error}</p>}
    <form className="transaction-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}>
      <div className="transaction-form-grid">
        <label>Goal name<input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></label>
        <label>Target (GBP)<input required inputMode="decimal" value={form.target} onChange={(event) => setForm({ ...form, target: event.currentTarget.value })} /></label>
        <label>Entered progress (GBP)<input required inputMode="decimal" value={form.progress} onChange={(event) => setForm({ ...form, progress: event.currentTarget.value })} /></label>
        <label>Target date (optional)<input type="date" min="1000-01-01" max="9999-12-31" value={form.targetDate}
          onChange={(event) => setForm({ ...form, targetDate: event.currentTarget.value })} /></label>
        <label className="goal-notes-field">Goal notes<textarea maxLength={1000} value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })} /></label>
      </div>
      </fieldset>
      <div className="modal-actions">
        <button type="submit" disabled={busy}>Save savings goal</button>
        <button type="button" disabled={busy} onClick={() => { setForm(empty); setShowForm(false); setError(""); }}>Cancel goal edit</button>
      </div>
    </form></Modal>}
  </section>;
}
