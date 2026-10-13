import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import Modal from "./Modal";

afterEach(cleanup);

describe("finance modal", () => {
  it("focuses the form, confines keyboard focus, and restores focus and background state", () => {
    const close = vi.fn();
    const view = render(<><button>Open editor</button><Modal title="Edit record" busy={false} onClose={close}>
      <label>Name<input /></label><button>Save</button>
    </Modal></>);
    const input = screen.getByLabelText("Name");
    const first = screen.getByRole("button", { name: "Close Edit record" });
    const last = screen.getByRole("button", { name: "Save" });
    expect(input).toBe(document.activeElement);
    expect(screen.getByRole("dialog")).toHaveProperty("ariaModal", "true");
    expect(screen.getByText("Open editor").hasAttribute("inert")).toBe(true);
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("blocks dismissal while saving and uses the updated close callback without resetting focus", () => {
    const firstClose = vi.fn(), nextClose = vi.fn();
    const view = render(<Modal title="Add record" busy={false} onClose={firstClose}><input aria-label="Amount" /></Modal>);
    const input = screen.getByLabelText("Amount");
    view.rerender(<Modal title="Add record" busy onClose={nextClose}><input aria-label="Amount" /></Modal>);
    expect(input).toBe(document.activeElement);
    expect(screen.getByRole("button", { name: "Close Add record" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(nextClose).not.toHaveBeenCalled();
    view.rerender(<Modal title="Add record" busy={false} onClose={nextClose}><input aria-label="Amount" /></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(nextClose).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();
  });

  it("restores the trigger and does not discard pre-existing inert state", () => {
    function Editor() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Add record</button>
        <div inert>Unavailable</div>
        {open && <Modal title="New record" busy={false} onClose={() => setOpen(false)}><input aria-label="Name" /></Modal>}
      </>;
    }
    render(<Editor />);
    const trigger = screen.getByRole("button", { name: "Add record" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toBe(document.activeElement);
    expect(trigger.hasAttribute("inert")).toBe(false);
    expect(screen.getByText("Unavailable").hasAttribute("inert")).toBe(true);
  });

  it("isolates background controls that arrive during an asynchronous list load", async () => {
    const close = vi.fn();
    const view = render(<><Modal key="editor" title="Add record" busy={false} onClose={close}><input aria-label="Name" /></Modal></>);
    const input = screen.getByLabelText("Name");
    view.rerender(<><button>Loaded background action</button><Modal key="editor" title="Add record" busy={false} onClose={close}><input aria-label="Name" /></Modal></>);
    expect(screen.getByLabelText("Name")).toBe(input);
    await waitFor(() => expect(screen.getByText("Loaded background action").hasAttribute("inert")).toBe(true));
    expect(screen.getByText("Loaded background action").getAttribute("aria-hidden")).toBe("true");
  });
});
