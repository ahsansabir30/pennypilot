import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("workspace setup and access", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a workspace and clears the passphrase after success", async () => {
    invokeMock.mockResolvedValueOnce("new");
    invokeMock.mockResolvedValueOnce(undefined);

    render(<App />);

    await screen.findByRole("heading", { name: "Create your workspace" });
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "a memorable long passphrase" },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "a memorable long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create secure workspace/ }));

    await screen.findByRole("heading", {
      name: "Your private space is unlocked.",
    });
    expect(invokeMock).toHaveBeenLastCalledWith("create_workspace_command", {
      passphrase: "a memorable long passphrase",
    });
  });

  it("surfaces an unlock error without presenting a success state", async () => {
    invokeMock.mockResolvedValueOnce("locked");
    invokeMock.mockRejectedValueOnce(
      "The passphrase could not unlock this workspace.",
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Unlock your workspace" });
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "incorrect passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The passphrase could not unlock this workspace.",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Your private space is unlocked.",
      }),
    ).toBeNull();
  });

  it("uses on-device recovery to replace a forgotten passphrase", async () => {
    invokeMock.mockResolvedValueOnce("locked");
    invokeMock.mockResolvedValueOnce(undefined);

    render(<App />);

    await screen.findByRole("heading", { name: "Unlock your workspace" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Forgot your passphrase? Recover on this device",
      }),
    );
    await screen.findByRole("heading", { name: "Set a new passphrase" });
    fireEvent.change(screen.getByLabelText("New passphrase"), {
      target: { value: "replacement passphrase for workspace" },
    });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), {
      target: { value: "replacement passphrase for workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Recover and continue/ }));

    await screen.findByRole("heading", {
      name: "Your private space is unlocked.",
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "recover_workspace_command",
      { passphrase: "replacement passphrase for workspace" },
    );
  });
});
