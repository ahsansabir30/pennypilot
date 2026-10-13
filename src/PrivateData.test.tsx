import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import PrivateData from "./PrivateData";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const props = { month: "2024-02", accounts: [{ id: 1, name: "Fictional account", currencyCode: "GBP" as const }],
  categories: [{ id: 1, name: "Fictional Food", categoryType: "expense" as const, color: "#123456" }],
  search: "Fictional", kind: "expense", categoryId: "1", onRestored: vi.fn() };
const PASSWORD = "fictional backup passphrase only";

describe("private data management", () => {
  beforeEach(() => {
    mock.mockReset(); props.onRestored.mockReset();
    mock.mockImplementation(async (command) => {
      if (command === "private_data_locations") return ["/fictional/app-data/private-exports", "/fictional/app-data/private-backups"];
      if (command === "restore_private_backup") return { safetyBackupPath: "/fictional/safety.ppbackup", recordCount: 2 };
      return { path: "/fictional/output.ppbackup", recordCount: 2 };
    });
  });
  afterEach(cleanup);

  it("defaults to the selected month and visible filters and requires plaintext consent", async () => {
    render(<PrivateData {...props} />);
    await screen.findByText("/fictional/app-data/private-backups");
    expect(screen.getByLabelText("Export from (inclusive)")).toHaveProperty("value", "2024-02-01");
    expect(screen.getByLabelText("Export through (inclusive)")).toHaveProperty("value", "2024-02-29");
    expect(screen.getByRole("button", { name: "Export scoped CSV" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("I understand this writes sensitive transactions to an unencrypted CSV file."));
    fireEvent.change(screen.getByLabelText("Export account"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Export scoped CSV" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("export_private_transactions", { confirmed: true, scope: {
      from: "2024-02-01", to: "2024-02-29", accountId: 1, categoryId: 1, kind: "expense", search: "Fictional",
    } }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", expect.stringContaining("This CSV is plaintext"));
  });

  it("creates a deliberately encrypted backup and clears passphrases after the operation", async () => {
    render(<PrivateData {...props} />);
    fireEvent.change(screen.getByLabelText("Backup passphrase"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm backup passphrase"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Create encrypted backup" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("create_private_backup", { passphrase: PASSWORD }));
    await waitFor(() => expect(screen.getByLabelText("Backup passphrase")).toHaveProperty("value", ""));
    expect(screen.getByLabelText("Confirm backup passphrase")).toHaveProperty("value", "");
    expect(screen.getByRole("status").textContent).not.toContain(PASSWORD);
  });

  it("rejects mismatched backup passphrases without creating a file", async () => {
    render(<PrivateData {...props} />);
    await screen.findByText("/fictional/app-data/private-backups");
    fireEvent.change(screen.getByLabelText("Backup passphrase"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm backup passphrase"), { target: { value: "different fictional passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Create encrypted backup" }));
    expect(screen.getByRole("alert").textContent).toContain("match");
    expect(mock).not.toHaveBeenCalledWith("create_private_backup", expect.anything());
  });

  it("requires replacement confirmation and refreshes all finance surfaces after restore", async () => {
    render(<PrivateData {...props} />);
    fireEvent.change(screen.getByLabelText("Local backup file path"), { target: { value: "/fictional/local.ppbackup" } });
    fireEvent.change(screen.getByLabelText("Restore backup passphrase"), { target: { value: PASSWORD } });
    expect(screen.getByRole("button", { name: "Validate and restore backup" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText(/Replace all current accounts/));
    fireEvent.change(screen.getByLabelText("Type RESTORE to confirm"), { target: { value: "RESTORE" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate and restore backup" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("restore_private_backup", {
      path: "/fictional/local.ppbackup", passphrase: PASSWORD, confirmation: "RESTORE",
    }));
    await waitFor(() => expect(props.onRestored).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Restore backup passphrase")).toHaveProperty("value", "");
    expect(screen.getByRole("status").textContent).toContain("/fictional/safety.ppbackup");
    expect(screen.getByRole("status").textContent).toContain("workspace unlock passphrase is unchanged");
  });

  it("reports failed restore without claiming success or refreshing unchanged records", async () => {
    mock.mockImplementation(async (command) => {
      if (command === "private_data_locations") return [];
      throw "Invalid backup. Existing data was not replaced.";
    });
    render(<PrivateData {...props} />);
    fireEvent.change(screen.getByLabelText("Local backup file path"), { target: { value: "/fictional/invalid.ppbackup" } });
    fireEvent.change(screen.getByLabelText("Restore backup passphrase"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByLabelText(/Replace all current accounts/));
    fireEvent.change(screen.getByLabelText("Type RESTORE to confirm"), { target: { value: "RESTORE" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate and restore backup" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invalid backup. Existing data was not replaced.");
    expect(props.onRestored).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("Restore backup passphrase")).toHaveProperty("value", "");
  });

  it("enforces calendar boundaries on export date inputs", async () => {
    render(<PrivateData {...props} />);
    const fromInput = screen.getByLabelText("Export from (inclusive)");
    const toInput = screen.getByLabelText("Export through (inclusive)");
    expect(fromInput.getAttribute("min")).toBe("1000-01-01");
    expect(fromInput.getAttribute("max")).toBe("9999-12-31");
    expect(toInput.getAttribute("min")).toBe("1000-01-01");
    expect(toInput.getAttribute("max")).toBe("9999-12-31");
  });
});
