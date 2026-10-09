import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByText("£0.00 entered progress / £100.00 target")).toBeTruthy();
    expect(screen.getByText("0.0% · £100.00 remaining")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveProperty("value", 0);
    expect(screen.getByText(/not a bank balance/)).toBeTruthy();
    expect(screen.getByText(/predict completion/)).toBeTruthy();
    expect(mock).not.toHaveBeenCalledWith("list_finance_data", expect.anything());
  });

  it("retains overfunding and labels dates as preferences, not forecasts", async () => {
    mock.mockResolvedValue([{ ...goal, progressPence: 12_345, targetDate: "2028-02-29" }]);
    render(<SavingsGoals />);
    expect(await screen.findByText("123.5% · £0.00 remaining")).toBeTruthy();
    expect(screen.getByText("Overfunded by £23.45; progress is retained, not capped.")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveProperty("value", 100);
    expect(screen.getByText(/Target date: 2028-02-29 \(your preference, not a forecast\)/)).toBeTruthy();
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
    expect(mock).not.toHaveBeenCalledWith("delete_savings_goal", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirm goal deletion" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("delete_savings_goal", { goalId: 1 }));
  });
});
