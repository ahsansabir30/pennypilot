import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { validateNewPassphrase } from "./security";

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            p
          </span>
          <span>PennyPilot</span>
        </div>
        <span className="privacy-pill">
          <span className="privacy-dot" />
          Your data stays on this device
        </span>
      </header>

      <section className="welcome-layout" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <span className="eyebrow">A clearer view of your money</span>
          <h1 id="welcome-title">
            Your finances,
            <br />
            <span>on your terms.</span>
          </h1>
          <p className="welcome-description">
            Understand your spending, stay ahead of subscriptions, and make
            progress toward what matters — privately, on your own device.
          </p>
          <div className="privacy-note">
            <span className="privacy-icon" aria-hidden="true">
              ◈
            </span>
            <p>
              <strong>Private by design</strong>
              <span>
                Your workspace is encrypted. PennyPilot never connects to your
                bank.
              </span>
            </p>
          </div>
        </div>

        <section className="workspace-card" aria-label="Secure workspace">
          {status === null ? (
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
          ) : status === "unlocked" ? (
            <div className="unlocked-state">
              <div className="card-symbol" aria-hidden="true">
                ✓
              </div>
              <span className="eyebrow">Workspace ready</span>
              <h2>Your private space is unlocked.</h2>
              <p>
                Your encrypted workspace is open on this device. Financial
                summaries will appear here as you add your own data.
              </p>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void lock()}
                type="button"
              >
                Lock workspace
              </button>
              {message && <p className="form-message error">{message}</p>}
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
              <p className="card-description">
                {mode === "create"
                  ? "Choose a passphrase to encrypt your financial data on this device."
                  : mode === "recover"
                    ? "Use this device’s secure recovery key to protect your workspace with a new passphrase."
                    : "Your encrypted financial data is stored locally on this device."}
              </p>

              <form className="passphrase-form" onSubmit={submit}>
                <label htmlFor="passphrase">
                  {mode === "recover" ? "New passphrase" : "Passphrase"}
                </label>
                <input
                  autoComplete={
                    mode === "create" ? "new-password" : "current-password"
                  }
                  autoFocus
                  id="passphrase"
                  onChange={(event) => setPassphrase(event.currentTarget.value)}
                  type="password"
                  value={passphrase}
                  required
                />
                {isNewPassphrase && (
                  <>
                    <span className="field-hint">
                      Use at least 12 characters. Longer is safer.
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
                  onClick={() => changeMode("recover")}
                  type="button"
                >
                  Forgot your passphrase? Recover on this device
                </button>
              ) : mode === "recover" ? (
                <button
                  className="text-button"
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
        <span>Made for a more confident relationship with money.</span>
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
