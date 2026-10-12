import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./App.css";
import { validateNewPassphrase } from "./security";
import Dashboard from "./Dashboard";
import Brand from "./Brand";

type WorkspaceStatus = "new" | "locked" | "unlocked";
type FormMode = "create" | "unlock" | "recover";

function App() {
  const [status, setStatus] = useState<WorkspaceStatus | "error" | null>(null);
  const [mode, setMode] = useState<FormMode>("create");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function refreshStatus() {
    if (!isTauri()) return;
    try {
      const nextStatus = await invoke<WorkspaceStatus>("workspace_status");
      setStatus(nextStatus);
      setMode(nextStatus === "new" ? "create" : "unlock");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }

  function changeMode(nextMode: FormMode) {
    setMode(nextMode);
    setPassphrase("");
    setConfirmation("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (mode !== "unlock") {
      const validation = validateNewPassphrase(passphrase, confirmation);
      if (validation) {
        setMessage(validation);
        return;
      }
    }

    setBusy(true);
    try {
      const command =
        mode === "create"
          ? "create_workspace_command"
          : mode === "recover"
            ? "recover_workspace_command"
            : "unlock_workspace_command";
      await invoke(command, { passphrase });
      setStatus("unlocked");
      setPassphrase("");
      setConfirmation("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    setBusy(true);
    setMessage("");
    try {
      await invoke("lock_workspace");
      setStatus("locked");
      setMode("unlock");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const isNewPassphrase = mode !== "unlock";

  if (status === "unlocked") {
    return <Dashboard onLock={() => void lock()} lockBusy={busy} lockError={message} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <span className="privacy-pill">
          <span className="privacy-dot" />
          Stored on this device
        </span>
      </header>

      <section className="welcome-layout" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <h1 id="welcome-title">
            Your money.<br /><span>Kept private.</span>
          </h1>
          <p className="welcome-description">
            Spending, budgets and savings in one encrypted workspace.
          </p>
          <div className="privacy-note">
            <span className="privacy-icon" aria-hidden="true">
              ◈
            </span>
            <p>
              <strong>Private by design</strong>
              <span>
                Local storage. No bank connection.
              </span>
            </p>
          </div>
        </div>

        <section className="workspace-card" aria-label="Secure workspace">
          {!isTauri() ? (
            <>
              <span className="eyebrow">Desktop app required</span>
              <h2>Open PennyPilot on desktop</h2>
              <p className="card-description">
                Your encrypted workspace is available only in the PennyPilot desktop app, not in a web browser.
              </p>
              <p className="card-description">
                For local development, run <code>npm run tauri dev</code> and use the desktop window that opens.
              </p>
            </>
          ) : status === null ? (
            <div className="loading-state" role="status">
              <span className="spinner" />
              <span>Preparing your secure workspace…</span>
            </div>
          ) : status === "error" ? (
            <div className="loading-state">
              <div>
                <p className="form-message error" role="alert">
                  {message}
                </p>
                <button
                  className="text-button"
                  onClick={() => void refreshStatus()}
                  type="button"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="card-symbol" aria-hidden="true">
                ◈
              </div>
              <span className="eyebrow">
                {mode === "create"
                  ? "A secure start"
                  : mode === "recover"
                    ? "Recover access"
                    : "Welcome back"}
              </span>
              <h2>
                {mode === "create"
                  ? "Create your workspace"
                  : mode === "recover"
                    ? "Set a new passphrase"
                    : "Unlock your workspace"}
              </h2>
              {mode === "recover" && <p className="card-description">Uses this device's recovery key. Your records stay unchanged.</p>}

              <form className="passphrase-form" onSubmit={submit}>
                <label htmlFor="passphrase">
                  {mode === "recover" ? "New passphrase" : "Passphrase"}
                </label>
                <input
                  autoComplete={
                    mode === "unlock" ? "current-password" : "new-password"
                  }
                  autoFocus
                  id="passphrase"
                  onChange={(event) => setPassphrase(event.currentTarget.value)}
                  type="password"
                  maxLength={1024}
                  value={passphrase}
                  required
                />
                {isNewPassphrase && (
                  <>
                    <span className="field-hint">
                      At least 12 characters.
                    </span>
                    <label htmlFor="confirm-passphrase">
                      Confirm passphrase
                    </label>
                    <input
                      autoComplete="new-password"
                      id="confirm-passphrase"
                      onChange={(event) =>
                        setConfirmation(event.currentTarget.value)
                      }
                      type="password"
                      maxLength={1024}
                      value={confirmation}
                      required
                    />
                  </>
                )}
                {message && (
                  <p className="form-message error" role="alert">
                    {message}
                  </p>
                )}
                <button className="primary-button" disabled={busy} type="submit">
                  {busy
                    ? "Securing workspace…"
                    : mode === "create"
                      ? "Create secure workspace"
                      : mode === "recover"
                        ? "Recover and continue"
                        : "Unlock"}
                  {!busy && <span aria-hidden="true">→</span>}
                </button>
              </form>

              {mode === "unlock" ? (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => changeMode("recover")}
                  type="button"
                >
                  Forgot your passphrase? Recover on this device
                </button>
              ) : mode === "recover" ? (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => changeMode("unlock")}
                  type="button"
                >
                  Back to unlock
                </button>
              ) : null}

              <div className="card-footnote">
                <span aria-hidden="true">●</span>
                Encrypted locally. No account or cloud required.
              </div>
            </>
          )}
        </section>
      </section>

      <footer className="page-footer">
        <span>Encrypted · Stored locally</span>
        <span>GBP · United Kingdom</span>
      </footer>
    </main>
  );
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "PennyPilot could not complete that action. Please try again.";
}

export default App;
