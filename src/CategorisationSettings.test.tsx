import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import CategorisationSettings from "./CategorisationSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const categories = [{ id: 1, name: "Groceries", categoryType: "expense" as const, color: "#D3A348" }];
const rule = { id: 5, pattern: "north market", matchType: "contains", categoryId: 1, priority: 10, enabled: true };

describe("categorisation management", () => {
  beforeEach(() => {
    mock.mockReset();
    mock.mockImplementation(async (command) => command === "list_category_rules" ? [rule] : undefined);
  });
  afterEach(cleanup);

  it("shows one panel at a time and preserves independent search values across tabs", async () => {
    render(<CategorisationSettings categories={categories} onChanged={vi.fn()} />);
    expect(screen.getByRole("tabpanel", { name: "Categories" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name: "Rules" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search categories"), { target: { value: "Gro" } });
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    await screen.findByRole("button", { name: "Edit rule north market" });
    expect(screen.queryByRole("button", { name: "Add category" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "north" } });
    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));
    expect(screen.getByLabelText("Search categories")).toHaveProperty("value", "Gro");
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    expect(screen.getByLabelText("Search rules")).toHaveProperty("value", "north");
  });
  it("combines case-insensitive category search and accounting type without changing records", async () => {
    render(<CategorisationSettings categories={[...categories,
      { id: 2, name: "Salary", categoryType: "income", color: "#123456" },
    ]} onChanged={vi.fn()} />);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("list_category_rules"));
    fireEvent.change(screen.getByLabelText("Search categories"), { target: { value: "  GRO  " } });
    expect(screen.getByRole("button", { name: "Edit Groceries" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Salary" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Category filter"), { target: { value: "income" } });
    expect(screen.getByText("No matching categories.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search categories"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Edit Salary" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Groceries" })).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("filters rules by merchant/category search, category and status while applying all rules explicitly", async () => {
    mock.mockResolvedValue([rule, { ...rule, id: 6, pattern: "fictional pay", categoryId: 2, enabled: false }]);
    render(<CategorisationSettings categories={[...categories,
      { id: 2, name: "Salary", categoryType: "income", color: "#123456" },
    ]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    await screen.findByRole("button", { name: "Edit rule north market" });
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "  SALARY " } });
    expect(screen.getByRole("button", { name: "Edit rule fictional pay" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit rule north market" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Rule status"), { target: { value: "enabled" } });
    expect(screen.getByText("No matching rules.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Rule status"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Rule category filter"), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Edit rule north market" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit rule fictional pay" })).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
    mock.mockImplementation(async (command) => command === "list_category_rules" ? [rule] : 2);
    fireEvent.click(screen.getByRole("button", { name: "Apply rules to automatic transactions" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("reclassify_transactions"));
  });

  it("uses short actions without explanatory disclosures or changing rule application", async () => {
    render(<CategorisationSettings categories={categories} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete Groceries" }).textContent).toBe("×");
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    const edit = await screen.findByRole("button", { name: "Edit rule north market" });
    expect(edit.textContent).toBe("");
    expect(edit.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByText("How rules work")).toBeNull();
    expect(screen.queryByText(/Higher priority wins|Conflicting ties stay uncategorised/)).toBeNull();
    const apply = screen.getByRole("button", { name: "Apply rules to automatic transactions" });
    expect(apply.textContent).toBe("Apply rules");
    fireEvent.click(apply);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("reclassify_transactions"));
  });

  it("edits category names and colours without changing the accounting type", async () => {
    const changed = vi.fn();
    render(<CategorisationSettings categories={categories} onChanged={changed} />);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("list_category_rules"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Groceries" }));
    expect(screen.getByLabelText("Category type")).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Food" } });
    fireEvent.change(screen.getByLabelText("Category colour"), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("save_category", { input: {
      id: 1, name: "Food", categoryType: "expense", color: "#123456",
    } }));
    expect(changed).toHaveBeenCalled();
  });

  it("selects palette colours, retains custom colours on failure and resets cancelled additions", async () => {
    mock.mockImplementation(async (command) => {
      if (command === "list_category_rules") return [rule];
      throw "Fictional save failed.";
    });
    render(<CategorisationSettings categories={categories} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(screen.getByRole("button", { name: "Sage colour" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Blue colour" }));
    expect(screen.getByRole("button", { name: "Sage colour" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Blue colour" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Category colour")).toHaveProperty("value", "#587ca6");
    fireEvent.change(screen.getByLabelText("Category colour"), { target: { value: "#123456" } });
    expect(screen.getByRole("button", { name: "Blue colour" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Fictional category" } });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Fictional save failed.");
    expect(screen.getByLabelText("Category colour")).toHaveProperty("value", "#123456");
    fireEvent.click(screen.getByRole("button", { name: "Cancel category edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(screen.getByRole("button", { name: "Sage colour" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("creates and edits rules with priority, method and enablement", async () => {
    render(<CategorisationSettings categories={categories} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("list_category_rules"));
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByLabelText("Merchant pattern"), { target: { value: "Coffee Shop" } });
    fireEvent.change(screen.getByLabelText("Rule category"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("save_category_rule", { input: {
      id: null, pattern: "Coffee Shop", matchType: "contains", categoryId: 1, priority: 40, enabled: true,
    } }));
    expect(mock).not.toHaveBeenCalledWith("reclassify_transactions");
    fireEvent.click(await screen.findByRole("button", { name: "Edit rule north market" }));
    fireEvent.change(screen.getByLabelText("Match method"), { target: { value: "exact" } });
    fireEvent.click(screen.getByLabelText("Rule enabled"));
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("save_category_rule", { input: {
      ...rule, matchType: "exact", enabled: false,
    } }));
  });

  it("requires deletion confirmation and surfaces referenced-category errors", async () => {
    mock.mockImplementation(async (command) => {
      if (command === "list_category_rules") return [rule];
      if (command === "delete_category") throw "This category is used by transactions or rules.";
      return undefined;
    });
    render(<CategorisationSettings categories={categories} onChanged={vi.fn()} />);
    await waitFor(() => expect(mock).toHaveBeenCalledWith("list_category_rules"));
    fireEvent.click(screen.getByRole("button", { name: "Delete Groceries" }));
    const dialog = screen.getByRole("dialog", { name: "Delete category" });
    expect(dialog.textContent).toContain("Delete Groceries?");
    expect(mock).not.toHaveBeenCalledWith("delete_category", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This category is used by transactions or rules.");
    expect(dialog.contains(alert)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete rule north market" }));
    expect(screen.getByRole("dialog", { name: "Delete rule" }).textContent).toContain("Delete the rule for north market?");
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("delete_category_rule", { ruleId: 5 }));
  });
});
