import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ConfirmDialog title="Delete record" message="Delete Fictional record? This cannot be undone." confirmLabel="Delete"
    confirmName="Confirm record deletion" cancelName="Cancel record deletion" busy={false}
    onConfirm={onConfirm} onCancel={onCancel} {...overrides} />);
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("focuses the safe cancel action and labels the destructive confirm", () => {
    const { onConfirm, onCancel } = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Delete record" });
    expect(dialog.textContent).toContain("Delete Fictional record? This cannot be undone.");
    const cancel = screen.getByRole("button", { name: "Cancel record deletion" });
    expect(document.activeElement).toBe(cancel);
    const confirm = screen.getByRole("button", { name: "Confirm record deletion" });
    expect(confirm.textContent).toBe("Delete");
    expect(confirm.className).toContain("destructive-action");
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole("button", { name: "Close Delete record" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("blocks dismissal while busy and keeps the failure inside the dialog", () => {
    const { onConfirm, onCancel } = renderDialog({ busy: true, error: "Category is in use." });
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("dialog").contains(screen.getByRole("alert"))).toBe(true);
    for (const name of ["Confirm record deletion", "Cancel record deletion", "Close Delete record"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
