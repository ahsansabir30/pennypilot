import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Category, CategoryRule } from "./finance";

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
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      await invoke("save_category", { input: category });
      setCategory(newCategory);
    }, "Category saved.");
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      await invoke("save_category_rule", { input: {
        ...rule, priority: Number(rule.priority), categoryId: Number(rule.categoryId),
      } });
      setRule(newRule);
    }, "Rule saved. Use Reclassify automatic transactions to apply it to existing records.");
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
      <h2 id="categorisation-title">Categories and rules</h2>
      <p className="policy-note">Higher priority wins. Conflicting ties stay uncategorised. Manual choices are protected.</p>
      {error && <p role="alert" className="form-message error">{error}</p>}
      {rulesError && <div role="alert" className="form-message error">{rulesError}
        <button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Retry rules</button></div>}
      {message && <p role="status" className="policy-note">{message}</p>}
      <div className="categorisation-grid">
        <div>
          <h3>Editable categories</h3>
          <ul className="settings-list">
            {categories.map((item) => <li key={item.id}>
              <span><i style={{ background: item.color }} />{item.name} ({item.categoryType})</span>
              <div>
                <button type="button" disabled={busy} onClick={() => setCategory(item)}>Edit {item.name}</button>
                <button type="button" disabled={busy} onClick={() => setPendingDelete({ type: "category", id: item.id })}>Delete {item.name}</button>
              </div>
            </li>)}
          </ul>
          <form className="transaction-form" onSubmit={(event) => void saveCategory(event)}>
            <h3>{category.id ? "Edit category" : "New category"}</h3>
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
            <button disabled={busy} type="submit">Save category</button>
            {category.id !== null && <button disabled={busy} type="button" onClick={() => setCategory(newCategory)}>Cancel category edit</button>}
          </form>
        </div>
        <div>
          <h3>Merchant rules</h3>
          {loading ? <p role="status">Loading rules...</p> : rulesError ? <p>Rules unavailable.</p> : <ul className="settings-list">
            {rules.map((item) => <li key={item.id}>
              <span>{item.pattern} → {categories.find((category) => category.id === item.categoryId)?.name ?? "Unknown category"}
                <small>{item.matchType === "contains" ? "Whole phrase" : "Exact name"} · Priority {item.priority} · {item.enabled ? "Enabled" : "Disabled"}</small>
              </span>
              <div>
                <button disabled={busy} type="button" onClick={() => setRule({ ...item, categoryId: String(item.categoryId), priority: String(item.priority) })}>Edit rule {item.pattern}</button>
                <button disabled={busy} type="button" onClick={() => setPendingDelete({ type: "rule", id: item.id })}>Delete rule {item.pattern}</button>
              </div>
            </li>)}
            {rules.length === 0 && <li>No rules yet.</li>}
          </ul>}
          <form className="transaction-form" onSubmit={(event) => void saveRule(event)}>
            <h3>{rule.id ? "Edit rule" : "New rule"}</h3>
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
            <button disabled={busy} type="submit">Save rule</button>
            {rule.id !== null && <button disabled={busy} type="button" onClick={() => setRule(newRule)}>Cancel rule edit</button>}
          </form>
        </div>
      </div>
      {pendingDelete && <div className="policy-note" role="group" aria-label="Confirm settings deletion">
        Delete this {pendingDelete.type}? Categories used by transactions or rules cannot be deleted.
        <button disabled={busy} type="button" onClick={() => void remove()}>Confirm deletion</button>
        <button disabled={busy} type="button" onClick={() => setPendingDelete(null)}>Cancel deletion</button>
      </div>}
      <button disabled={busy || loading || Boolean(rulesError)} type="button" onClick={() => void perform(async () => {
        return await invoke<number>("reclassify_transactions");
      }, (count) => `${count} automatic transaction${count === 1 ? "" : "s"} reclassified. Manual choices preserved.`)}>Reclassify automatic transactions</button>
    </section>
  );
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "PennyPilot could not save these categorisation settings.";
}
