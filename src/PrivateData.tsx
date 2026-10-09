import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { financeError, localIsoDate } from "./finance";
import { validateNewPassphrase } from "./security";
import type { Account, Category } from "./finance";

type SavedFile = { path: string; recordCount: number };
type RestoreResult = { safetyBackupPath: string; recordCount: number };

export default function PrivateData({ month, accounts, categories, search, kind, categoryId, onRestored }: {
  month: string; accounts: Account[]; categories: Category[]; search: string; kind: string;
  categoryId: string; onRestored: () => void;
}) {
  const [locations, setLocations] = useState<string[]>([]);
  const [scope, setScope] = useState(() => {
    const [year, number] = month.split("-").map(Number);
    return { from: `${month}-01`, to: localIsoDate(new Date(year, number, 0)), accountId: "", categoryId, kind, search };
  });
  const [exportConsent, setExportConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreConsent, setRestoreConsent] = useState(false);
  const [restoreText, setRestoreText] = useState("");

  useEffect(() => {
    let active = true;
    invoke<string[]>("private_data_locations").then((paths) => { if (active) setLocations(paths); })
      .catch((error: unknown) => { if (active) setError(financeError(error)); });
    return () => { active = false; };
  }, []);

  async function exportTransactions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!exportConsent) { setError("Confirm the plaintext disclosure warning before exporting."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const file = await invoke<SavedFile>("export_private_transactions", { confirmed: true, scope: {
        from: scope.from, to: scope.to, accountId: scope.accountId ? Number(scope.accountId) : null,
        categoryId: scope.categoryId ? Number(scope.categoryId) : null, kind: scope.kind || null, search: scope.search,
      } });
      setMessage(`Exported ${file.recordCount} transactions: ${file.path}. This CSV is plaintext.`);
      setExportConsent(false);
    } catch (error) { setError(financeError(error)); }
    finally { setBusy(false); }
  }

  async function createBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateNewPassphrase(passphrase, confirmation);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const file = await invoke<SavedFile>("create_private_backup", { passphrase });
      setMessage(`Encrypted backup: ${file.path} · ${file.recordCount} transactions. Keep the backup passphrase separately.`);
    } catch (error) { setError(financeError(error)); }
    finally { setPassphrase(""); setConfirmation(""); setBusy(false); }
  }

  async function restoreBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restoreConsent || restoreText !== "RESTORE") {
      setError("Confirm replacement and type RESTORE before restoring.");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await invoke<RestoreResult>("restore_private_backup", {
        path: restorePath, passphrase: restorePassphrase, confirmation: restoreText,
      });
      setMessage(`Restored ${result.recordCount} transactions. Safety backup: ${result.safetyBackupPath} (uses this backup passphrase). Your workspace unlock passphrase is unchanged.`);
      setRestoreConsent(false); setRestoreText(""); setExportConsent(false);
      setScope((current) => ({ ...current, accountId: "", categoryId: "", kind: "", search: "" }));
      onRestored();
    } catch (error) { setError(financeError(error)); }
    finally { setRestorePassphrase(""); setBusy(false); }
  }

  return <section id="private-data-panel" className="panel finance-management" aria-labelledby="private-data-title">
    <h2 id="private-data-title">Private export and backup</h2>
    <p className="policy-note">Local files. Backups contain records and notes, not workspace credentials.</p>
    <details className="calculation-details"><summary>Local file locations</summary>
      {locations.map((path) => <p key={path} className="local-file-path">{path}</p>)}</details>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status" className="local-file-path">{message}</p>}
    <form className="transaction-form" onSubmit={(event) => void exportTransactions(event)}>
      <h3>Export transactions</h3>
      <details className="calculation-details"><summary>CSV format</summary><p className="policy-note">UTF-8 with BOM, comma-separated, CRLF rows; GBP decimal pounds with two places plus integer pence.
        Source dates use YYYY-MM-DD. All amounts are positive; kind distinguishes expenses, income, refunds and transfers.
        Spreadsheet-sensitive cells are prefixed with an apostrophe. CSV is a report, not a restorable backup.</p></details>
      <div className="transaction-form-grid">
        <label>Export from (inclusive)<input required type="date" value={scope.from} onChange={(event) => setScope({ ...scope, from: event.currentTarget.value })} /></label>
        <label>Export through (inclusive)<input required type="date" value={scope.to} onChange={(event) => setScope({ ...scope, to: event.currentTarget.value })} /></label>
        <label>Export account<select value={scope.accountId} onChange={(event) => setScope({ ...scope, accountId: event.currentTarget.value })}>
          <option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></label>
        <label>Export category<select value={scope.categoryId} onChange={(event) => setScope({ ...scope, categoryId: event.currentTarget.value })}>
          <option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <label>Export type<select value={scope.kind} onChange={(event) => setScope({ ...scope, kind: event.currentTarget.value })}>
          <option value="">All types</option>{["income", "expense", "refund", "transfer"].map((type) => <option key={type} value={type}>{type}</option>)}
        </select></label>
        <label>Export search<input maxLength={100} value={scope.search} onChange={(event) => setScope({ ...scope, search: event.currentTarget.value })} /></label>
      </div>
      <label className="consent-label"><input type="checkbox" checked={exportConsent} onChange={(event) => setExportConsent(event.currentTarget.checked)} />
        I understand this writes sensitive transactions to an unencrypted CSV file.</label>
      <button disabled={busy || !exportConsent} type="submit">Export scoped CSV</button>
    </form>
    <form className="transaction-form" onSubmit={(event) => void createBackup(event)}>
      <h3>Create encrypted backup</h3>
      <p className="policy-note">Separate passphrase · 12+ characters. It cannot be recovered; keep it safe.</p>
      <div className="transaction-form-grid">
        <label>Backup passphrase<input required type="password" autoComplete="new-password" maxLength={1024} value={passphrase} onChange={(event) => setPassphrase(event.currentTarget.value)} /></label>
        <label>Confirm backup passphrase<input required type="password" autoComplete="new-password" maxLength={1024} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} /></label>
      </div>
      <button type="submit" disabled={busy}>Create encrypted backup</button>
    </form>
    <form className="transaction-form" onSubmit={(event) => void restoreBackup(event)}>
      <h3>Restore an encrypted backup</h3>
      <p className="policy-note">Replaces your financial records after validation. An encrypted safety backup is created first using the entered backup passphrase.</p>
      <div className="transaction-form-grid">
        <label className="goal-notes-field">Local backup file path<input required value={restorePath} onChange={(event) => setRestorePath(event.currentTarget.value)} /></label>
        <label>Restore backup passphrase<input required type="password" autoComplete="off" maxLength={1024} value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.currentTarget.value)} /></label>
        <label>Type RESTORE to confirm<input required value={restoreText} onChange={(event) => setRestoreText(event.currentTarget.value)} /></label>
      </div>
      <label className="consent-label"><input type="checkbox" checked={restoreConsent} onChange={(event) => setRestoreConsent(event.currentTarget.checked)} />
        Replace all current accounts, categories, transactions, rules, budgets, preferences and savings goals.</label>
      <button type="submit" disabled={busy || !restoreConsent || restoreText !== "RESTORE"}>Validate and restore backup</button>
    </form>
  </section>;
}
