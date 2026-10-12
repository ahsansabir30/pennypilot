import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import SavingsGoals from "./SavingsGoals";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const goal = { id: 1, name: "Fictional rainy day", targetPence: 10_000, progressPence: 0, targetDate: null, notes: "Entered manually" };

describe("savings goals", () => {
  beforeEach(() => { mock.mockReset(); mock.mockImplementation(async (command) => command === "list_savings_goals" ? [goal] : undefined); });
  afterEach(cleanup);

  it("shows zero progress without treating transactions as balance evidence", async () => {
    render(<SavingsGoals />);
    expect(await screen.findByText("£0.00 / £100.00 target")).toBeTruthy();
    expect(screen.getByText("0.0% · £100.00 remaining")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveProperty("value", 0);
    expect(screen.queryByText(/not a bank balance|completion predicted|No target date/)).toBeNull();
    expect(mock).not.toHaveBeenCalledWith("list_finance_data", expect.anything());
  });

  it("keeps concise actions accessible without calculation prose", async () => {
    render(<SavingsGoals />);
    const edit = await screen.findByRole("button", { name: "Edit goal Fictional rainy day" });
    expect(edit.textContent).toBe("");
    expect(edit.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getByRole("button", { name: "Delete goal Fictional rainy day" }).textContent).toBe("×");
    expect(screen.queryByText("Calculation details")).toBeNull();
    expect(screen.queryByText(/not a bank balance/)).toBeNull();
    expect(screen.queryByText("Manual progress. No money is moved.")).toBeNull();
  });

  it("retains overfunding and labels dates as preferences, not forecasts", async () => {
    mock.mockResolvedValue([{ ...goal, progressPence: 12_345, targetDate: "2028-02-29" }]);
    render(<SavingsGoals />);
    expect(await screen.findByText("123.5% · £0.00 remaining")).toBeTruthy();
    expect(screen.getByText("Overfunded by £23.45; progress is retained.")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveProperty("value", 100);
    expect(screen.getByText("2028-02-29").getAttribute("datetime")).toBe("2028-02-29");
    expect(screen.queryByText(/forecast/)).toBeNull();
  });

  it("edits names, target, explicitly entered progress, date and notes using exact pence", async () => {
    render(<SavingsGoals />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit goal Fictional rainy day" }));
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Fictional holiday" } });
    fireEvent.change(screen.getByLabelText("Target (GBP)"), { target: { value: "200.01" } });
    fireEvent.change(screen.getByLabelText("Entered progress (GBP)"), { target: { value: "20.02" } });
    fireEvent.change(screen.getByLabelText("Target date (optional)"), { target: { value: "2028-02-29" } });
    fireEvent.change(screen.getByLabelText("Goal notes"), { target: { value: "Known local funds only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save savings goal" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("save_savings_goal", { input: {
      id: 1, name: "Fictional holiday", targetPence: 20_001, progressPence: 2_002, targetDate: "2028-02-29", notes: "Known local funds only",
    } }));
  });

  it.each(["0", "-1", "1.001"])("rejects invalid target %s and does not save", async (target) => {
    render(<SavingsGoals />);
    await screen.findByRole("heading", { name: "Fictional rainy day" });
    fireEvent.click(screen.getByRole("button", { name: "Add savings goal" }));
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Fictional goal" } });
    fireEvent.change(screen.getByLabelText("Target (GBP)"), { target: { value: target } });
    fireEvent.click(screen.getByRole("button", { name: "Save savings goal" }));
    expect(screen.getByRole("alert").textContent).toContain("positive target");
    expect(mock).not.toHaveBeenCalledWith("save_savings_goal", expect.anything());
  });

  it("creates a zero-progress goal and reports save errors", async () => {
    mock.mockImplementation(async (command) => {
      if (command === "list_savings_goals") return [];
      throw "Workspace is locked.";
    });
    render(<SavingsGoals />);
    await screen.findByText(/No savings goals yet/);
    fireEvent.click(screen.getByRole("button", { name: "Add savings goal" }));
    fireEvent.change(screen.getByLabelText("Goal name"), { target: { value: "Fictional start" } });
    fireEvent.change(screen.getByLabelText("Target (GBP)"), { target: { value: "1.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save savings goal" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("save_savings_goal", { input: {
      id: null, name: "Fictional start", targetPence: 101, progressPence: 0, targetDate: null, notes: "",
    } }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Workspace is locked."));
  });

  it("rejects negative progress without inferring a replacement from transactions", async () => {
    render(<SavingsGoals />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit goal Fictional rainy day" }));
    fireEvent.change(screen.getByLabelText("Entered progress (GBP)"), { target: { value: "-0.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save savings goal" }));
    expect(screen.getByRole("alert").textContent).toContain("non-negative progress");
    expect(mock).not.toHaveBeenCalledWith("save_savings_goal", expect.anything());
  });

  it("requires deliberate deletion confirmation", async () => {
    render(<SavingsGoals />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete goal Fictional rainy day" }));
    expect(screen.getByRole("dialog", { name: "Delete savings goal" }).textContent).toContain("Delete Fictional rainy day?");
    expect(mock).not.toHaveBeenCalledWith("delete_savings_goal", expect.anything());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock).not.toHaveBeenCalledWith("delete_savings_goal", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Delete goal Fictional rainy day" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm goal deletion" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("delete_savings_goal", { goalId: 1 }));
  });

  it("hides obsolete goals after deletion while refreshing and after a failed reload", async () => {
    render(<SavingsGoals />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete goal Fictional rainy day" }));
    let reject!: (error: Error) => void;
    mock.mockImplementation(async (command) => {
      if (command === "list_savings_goals") return new Promise((_, fail) => { reject = fail; });
      return undefined;
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm goal deletion" }));
    await screen.findByText("Loading savings goals...");
    expect(screen.queryByRole("button", { name: "Edit goal Fictional rainy day" })).toBeNull();
    await act(async () => reject(new Error("Fictional reload failed.")));
    expect(screen.getByRole("alert").textContent).toContain("Fictional reload failed.");
    expect(screen.queryByText("No savings goals yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete goal Fictional rainy day" })).toBeNull();
    mock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry goals" }));
    await screen.findByText("No savings goals yet.");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
