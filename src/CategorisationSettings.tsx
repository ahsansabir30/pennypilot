import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Category, CategoryRule } from "./finance";
import Modal from "./Modal";

type Props = { categories: Category[]; onChanged: () => void };
const newCategory = { id: null as number | null, name: "", categoryType: "expense", color: "#66896D" };
const newRule = { id: null as number | null, pattern: "", matchType: "contains", categoryId: "", priority: "20", enabled: true };

export default function CategorisationSettings({ categories, onChanged }: Props) {
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [category, setCategory] = useState(newCategory);
  const [rule, setRule] = useState(newRule);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<{ type: "category" | "rule"; id: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [rulesError, setRulesError] = useState("");
  const [editor, setEditor] = useState<"category" | "rule" | null>(null);

  useEffect(() => {
    let active = true;
    invoke<CategoryRule[]>("list_category_rules")
      .then((data) => { if (active) { setRules(data); setRulesError(""); } })
      .catch((error: unknown) => { if (active) setRulesError(errorText(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  async function perform<T>(operation: () => Promise<T>, success: string | ((result: T) => string)) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await operation();
      setMessage(typeof success === "function" ? success(result) : success); setPendingDelete(null);
      setRevision((value) => value + 1);
      onChanged();
      return true;
    } catch (error) {
      setError(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await perform(async () => {
      await invoke("save_category", { input: category });
      setCategory(newCategory);
    }, "Category saved.")) setEditor(null);
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await perform(async () => {
      await invoke("save_category_rule", { input: {
        ...rule, priority: Number(rule.priority), categoryId: Number(rule.categoryId),
      } });
      setRule(newRule);
    }, "Rule saved. Apply rules to update existing automatic transactions.")) setEditor(null);
  }

  async function remove() {
    if (!pendingDelete) return;
    const pending = pendingDelete;
    await perform(async () => {
      if (pending.type === "rule") {
        await invoke("delete_category_rule", { ruleId: pending.id });
        if (rule.id === pending.id) setRule(newRule);
      } else {
        await invoke("delete_category", { categoryId: pending.id });
        if (category.id === pending.id) setCategory(newCategory);
      }
    }, "Deleted. Existing manual category choices are preserved.");
  }

  return (
    <section id="categorisation-panel" className="panel categorisation-panel" aria-labelledby="categorisation-title">
      <h2 id="categorisation-title" className="visually-hidden">Categories and rules</h2>
      {error && !editor && <p role="alert" className="form-message error">{error}</p>}
      {rulesError && <div role="alert" className="form-message error">{rulesError}
        <button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Retry rules</button></div>}
      {message && <p role="status" className="policy-note">{message}</p>}
      <div className="categorisation-grid">
        <div>
          <div className="management-heading">
          <h3>Categories</h3>
          <button className="add-transaction-button" type="button" disabled={busy} onClick={() => { setCategory(newCategory); setError(""); setEditor("category"); }}>Add category</button>
          </div>
          <ul className="settings-list" aria-label="Categories">
            {categories.map((item) => <li key={item.id}>
              <span><i className="budget-category-dot" aria-hidden="true" style={{ background: item.color }} />{item.name}<small className="category-type">{item.categoryType}</small></span>
              <div className="management-row-actions">
                <button type="button" aria-label={`Edit ${item.name}`} disabled={busy} onClick={() => { setCategory(item); setError(""); setEditor("category"); }}>Edit</button>
                <button type="button" className="destructive-action" aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => setPendingDelete({ type: "category", id: item.id })}>Delete</button>
              </div>
            </li>)}
          </ul>
          {editor === "category" && <Modal title={category.id ? "Edit category" : "Add category"} busy={busy} onClose={() => { setEditor(null); setError(""); }}>
          {error && <p role="alert">{error}</p>}
          <form className="transaction-form" onSubmit={(event) => void saveCategory(event)}>
            <fieldset disabled={busy}>
            <div className="transaction-form-grid">
              <label>Category name<input required maxLength={60} value={category.name}
                onChange={(event) => setCategory({ ...category, name: event.currentTarget.value })} /></label>
              <label>Category type<select disabled={category.id !== null} value={category.categoryType}
                onChange={(event) => setCategory({ ...category, categoryType: event.currentTarget.value })}>
                <option value="expense">Expense</option><option value="income">Income</option>
              </select></label>
              <label>Category colour<input type="color" value={category.color}
                onChange={(event) => setCategory({ ...category, color: event.currentTarget.value })} /></label>
            </div>
            </fieldset>
            <div className="modal-actions">
            <button disabled={busy} type="submit" aria-label="Save category">Save</button>
            <button disabled={busy} type="button" aria-label="Cancel category edit" onClick={() => { setCategory(newCategory); setEditor(null); setError(""); }}>Cancel</button>
            </div>
          </form></Modal>}
        </div>
        <div>
          <div className="management-heading">
          <h3>Merchant rules</h3>
          <button className="add-transaction-button" type="button" disabled={busy || categories.length === 0} onClick={() => { setRule(newRule); setError(""); setEditor("rule"); }}>Add rule</button>
          </div>
          <p className="policy-note">Match merchants automatically.</p>
          <details className="calculation-details"><summary>How rules work</summary>
            <p>Higher priority wins. Conflicting ties stay uncategorised. Rules match normalized exact names or whole phrases and the category type; transfers are excluded.</p>
          </details>
          {categories.length === 0 && <p className="policy-note">Add a category before creating a rule.</p>}
          {loading ? <p role="status">Loading rules...</p> : rulesError ? <p>Rules unavailable.</p> : <ul className="settings-list" aria-label="Merchant rules">
            {rules.map((item) => <li key={item.id}>
              <span>{item.pattern} → {categories.find((category) => category.id === item.categoryId)?.name ?? "Unknown category"}
                <small>{item.matchType === "contains" ? "Whole phrase" : "Exact name"} · Priority {item.priority} · {item.enabled ? "Enabled" : "Disabled"}</small>
              </span>
              <div className="management-row-actions">
                <button disabled={busy} type="button" aria-label={`Edit rule ${item.pattern}`} onClick={() => { setRule({ ...item, categoryId: String(item.categoryId), priority: String(item.priority) }); setError(""); setEditor("rule"); }}>Edit</button>
                <button disabled={busy} type="button" className="destructive-action" aria-label={`Delete rule ${item.pattern}`} onClick={() => setPendingDelete({ type: "rule", id: item.id })}>Delete</button>
              </div>
            </li>)}
            {rules.length === 0 && <li>No rules yet.</li>}
          </ul>}
          {editor === "rule" && <Modal title={rule.id ? "Edit rule" : "Add rule"} busy={busy} onClose={() => { setEditor(null); setError(""); }}>
          {error && <p role="alert">{error}</p>}
          <form className="transaction-form" onSubmit={(event) => void saveRule(event)}>
            <fieldset disabled={busy}>
            <div className="transaction-form-grid">
              <label>Merchant pattern<input required maxLength={120} value={rule.pattern}
                onChange={(event) => setRule({ ...rule, pattern: event.currentTarget.value })} /></label>
              <label>Match method<select value={rule.matchType}
                onChange={(event) => setRule({ ...rule, matchType: event.currentTarget.value })}>
                <option value="contains">Whole phrase anywhere</option><option value="exact">Exact normalized name</option>
              </select></label>
              <label>Rule category<select required value={rule.categoryId}
                onChange={(event) => setRule({ ...rule, categoryId: event.currentTarget.value })}>
                <option value="">Choose a category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.categoryType})</option>)}
              </select></label>
              <label>Priority<input required type="number" min={0} max={1000} step={1} value={rule.priority}
                onChange={(event) => setRule({ ...rule, priority: event.currentTarget.value })} /></label>
              <label className="enabled-rule"><input type="checkbox" checked={rule.enabled}
                onChange={(event) => setRule({ ...rule, enabled: event.currentTarget.checked })} />Rule enabled</label>
            </div>
            </fieldset>
            <div className="modal-actions">
            <button disabled={busy} type="submit" aria-label="Save rule">Save</button>
            <button disabled={busy} type="button" aria-label="Cancel rule edit" onClick={() => { setRule(newRule); setEditor(null); setError(""); }}>Cancel</button>
            </div>
          </form></Modal>}
        </div>
      </div>
      {pendingDelete && <div className="policy-note" role="group" aria-label="Confirm settings deletion">
        Delete this {pendingDelete.type}? Categories in use cannot be deleted.
        <button disabled={busy} type="button" onClick={() => void remove()}>Confirm deletion</button>
        <button disabled={busy} type="button" onClick={() => setPendingDelete(null)}>Cancel deletion</button>
      </div>}
      <div className="rules-apply">
      <p className="policy-note">Apply rule changes to existing automatic transactions. Manual choices stay unchanged.</p>
      <button aria-label="Apply rules to automatic transactions" disabled={busy || loading || Boolean(rulesError)} type="button" onClick={() => void perform(async () => {
        return await invoke<number>("reclassify_transactions");
      }, (count) => `${count} automatic transaction${count === 1 ? "" : "s"} reclassified. Manual choices preserved.`)}>Apply rules</button>
      </div>
    </section>
  );
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "PennyPilot could not save these categorisation settings.";
}
