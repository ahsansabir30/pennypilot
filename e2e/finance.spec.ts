import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function home(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Financial overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Fictional Merchant 16", exact: true })).toBeVisible();
}

async function addExpense(page: Page, merchant = "Fictional Coffee Shop", amount = "12.34") {
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Amount (GBP)", { exact: true }).fill(amount);
  await page.getByLabel("Transaction date", { exact: true }).fill("2024-02-15");
  await page.getByLabel("Category", { exact: true }).selectOption("1");
  await page.getByLabel("Description", { exact: true }).fill("Fictional expense");
  await page.getByLabel("Merchant optional", { exact: true }).fill(merchant);
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByText(merchant, { exact: true })).toBeVisible();
}

test("home, all workspace navigation controls and repeated editor shortcuts work", async ({ page }) => {
  await home(page);
  const summary = page.getByRole("region", { name: "2024-02 financial summary" });
  await expect(summary.getByRole("article").filter({ has: page.getByText("Income", { exact: true }) })).toContainText("£2.00");
  await expect(summary.getByRole("article").filter({ has: page.getByText("Spending", { exact: true }) })).toContainText("£124.00");
  await expect(summary.getByRole("article").filter({ has: page.getByText("Net cash flow", { exact: true }) })).toContainText("-£122.00");
  for (const title of ["Budget check-in", "Savings at a glance", "Monthly trend", "Spending by category", "Transactions"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Set your first budget", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monthly category budgets" })).toBeFocused();
  await page.getByRole("button", { name: "Manage budgets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monthly category budgets" })).toBeFocused();
  await page.getByRole("button", { name: "Create your first goal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Savings goals", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Monthly category budgets" })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage goals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Savings goals", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Manage savings goals", exact: true }).click();
  await expect(page.getByRole("region", { name: "Savings goals", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Monthly budgets and insights", exact: true }).click();
  await expect(page.getByRole("region", { name: "Monthly category budgets" })).toBeVisible();
  await page.getByRole("button", { name: "Private export and backup", exact: true }).click();
  await expect(page.getByRole("region", { name: "Private export and backup" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Monthly category budgets" })).toHaveCount(0);
  await page.getByRole("button", { name: "Private export and backup", exact: true }).click();
  await expect(page.getByRole("region", { name: "Private export and backup" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("transactions validate, close, save exact pence, preserve manual categories and confirm deletion", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  expect(await page.getByLabel("Amount (GBP)", { exact: true }).evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(true);
  await page.getByRole("button", { name: "Close transaction form" }).click();
  await expect(page.getByRole("button", { name: "Save transaction", exact: true })).toHaveCount(0);
  await addExpense(page);
  const last = await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "create_transaction").slice(-1)[0]);
  expect(last.args.input).toMatchObject({ amountPence: 1234, transactionDate: "2024-02-15", categoryId: 1, manualCategory: true });
  const row = page.getByRole("row").filter({ has: page.getByText("Fictional Coffee Shop", { exact: true }) });
  await row.getByText("Category details", { exact: true }).click();
  await expect(row.getByText("Manual choice preserved.", { exact: true })).toBeVisible();
  await row.getByRole("combobox", { name: "Category for Fictional Coffee Shop", exact: true }).selectOption("");
  await expect(row.getByRole("combobox", { name: "Category for Fictional Coffee Shop", exact: true })).toHaveValue("");
  await row.getByRole("button", { name: "Use rules for Fictional Coffee Shop", exact: true }).click();
  await expect(row.getByRole("combobox", { name: "Category for Fictional Coffee Shop", exact: true })).toHaveValue("automatic");
  await row.getByRole("button", { name: "Delete Fictional Coffee Shop", exact: true }).click();
  await row.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row.getByRole("button", { name: "Delete Fictional Coffee Shop", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Delete Fictional Coffee Shop", exact: true }).click();
  await row.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Fictional Coffee Shop", { exact: true })).toHaveCount(0);
});

test("search, every sort, filters, pagination and source-month controls work", async ({ page }) => {
  await home(page);
  await expect(page.getByText("1–10 of 16", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("11–16 of 16", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText("1–10 of 16", { exact: true })).toBeVisible();
  const firstRows: Record<string, string> = {
    date_asc: "Fictional Merchant 1", date_desc: "Fictional Merchant 16",
    amount_asc: "Fictional Merchant 1", amount_desc: "Fictional Merchant 16", merchant_asc: "Fictional Merchant 1",
  };
  for (const [sort, merchant] of Object.entries(firstRows)) {
    await page.getByRole("combobox", { name: "Sort transactions", exact: true }).selectOption(sort);
    await expect(page.getByRole("row").nth(1)).toContainText(merchant);
    await expect.poll(async () => page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "list_transactions").slice(-1)[0].args.filter)).toMatchObject({ sort });
  }
  await page.getByRole("textbox", { name: "Search transactions", exact: true }).fill("does not exist");
  await expect(page.getByText("No transactions match these filters.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search transactions", exact: true })).toHaveValue("");
  await page.getByRole("combobox", { name: "Filter by type", exact: true }).selectOption("transfer");
  await expect(page.getByText("Fictional Merchant 4", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Category for Fictional Merchant 4", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Filter by type", exact: true }).selectOption("refund");
  await expect(page.getByText("Fictional Merchant 3", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by type", exact: true }).selectOption("expense");
  await expect(page.getByText("Fictional Merchant 1", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by type", exact: true }).selectOption("income");
  await page.getByRole("combobox", { name: "Filter by category", exact: true }).selectOption("2");
  await expect(page.getByText("Fictional Merchant 2", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Dashboard month", exact: true }).fill("2024-01");
  await expect(page.getByText("No transactions match these filters.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter by type", exact: true })).toHaveValue("income");
  await expect(page.getByRole("combobox", { name: "Filter by category", exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByText("No transactions this month.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Dashboard month", exact: true }).fill("2024-02");
  await expect(page.getByText("Fictional Merchant 2", { exact: true })).toBeVisible();
});

test("budget add, validation, edit/cancel, comparison, details and remove/cancel work", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Manage budgets", exact: true }).click();
  const panel = page.getByRole("region", { name: "Monthly category budgets" });
  await panel.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  expect(await panel.getByLabel("Budget category").evaluate((element: HTMLSelectElement) => element.validity.valueMissing)).toBe(true);
  await panel.getByLabel("Budget category").selectOption("1");
  await panel.getByLabel("Monthly limit (GBP)").fill("1.001");
  await panel.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("two decimal places");
  await panel.getByLabel("Monthly limit (GBP)").fill("500.01");
  await panel.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Budget saved for 2024-02.");
  await expect(panel.getByLabel("Monthly limit (GBP)")).toHaveValue("");
  await expect(page.getByRole("article", { name: "Budget check-in" })).toContainText("£500.01");
  await panel.getByRole("button", { name: "Edit budget for Fictional Food", exact: true }).click();
  await expect(panel.getByLabel("Monthly limit (GBP)")).toHaveValue("500.01");
  await panel.getByRole("button", { name: "Clear budget form", exact: true }).click();
  await expect(panel.getByLabel("Budget category")).toHaveValue("");
  await panel.getByText("Period details", { exact: true }).click();
  await expect(panel.getByText(/current period 2024-02-01 through 2024-02-15/)).toBeVisible();
  await panel.getByText("Calculation details", { exact: true }).click();
  await expect(panel.getByText(/No comparable category records/)).toBeVisible();
  await panel.getByRole("combobox", { name: "Comparison period", exact: true }).selectOption("full_month");
  await expect(panel.getByRole("status")).toHaveText("Comparison preference saved.");
  await expect(panel.getByRole("combobox", { name: "Comparison period", exact: true })).toHaveValue("full_month");
  await panel.getByRole("button", { name: "Remove budget for Fictional Food", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel budget removal", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Confirm budget removal" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Remove budget for Fictional Food", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm budget removal", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit budget for Fictional Food", exact: true })).toHaveCount(0);
});

test("savings add, invalid values, explicit progress, edit/cancel, notes and delete/cancel work", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Manage goals", exact: true }).click();
  const panel = page.getByRole("region", { name: "Savings goals", exact: true });
  await panel.getByRole("button", { name: "Save savings goal", exact: true }).click();
  expect(await panel.getByLabel("Goal name").evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(true);
  await panel.getByLabel("Goal name").fill("Fictional holiday");
  await panel.getByLabel("Target (GBP)", { exact: true }).fill("0");
  await panel.getByRole("button", { name: "Save savings goal", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("positive target");
  await panel.getByLabel("Target (GBP)", { exact: true }).fill("100.01");
  await panel.getByLabel("Entered progress (GBP)").fill("0");
  await panel.getByLabel("Target date (optional)").fill("2028-02-29");
  await panel.getByLabel("Goal notes").fill("Fictional note only");
  await panel.getByRole("button", { name: "Save savings goal", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Savings goal saved.");
  await panel.getByRole("button", { name: "Edit goal Fictional holiday", exact: true }).click();
  await expect(panel.getByLabel("Target date (optional)")).toHaveValue("2028-02-29");
  await panel.getByRole("button", { name: "Cancel goal edit", exact: true }).click();
  await expect(panel.getByLabel("Goal name")).toHaveValue("");
  await panel.getByRole("button", { name: "Edit goal Fictional holiday", exact: true }).click();
  await panel.getByLabel("Entered progress (GBP)").fill("120");
  await panel.getByRole("button", { name: "Save savings goal", exact: true }).click();
  await expect(page.getByRole("article", { name: "Savings at a glance" })).toContainText("Target reached");
  await panel.getByText("Calculation details", { exact: true }).click();
  await expect(panel.getByText(/your preference, not a forecast/)).toBeVisible();
  await panel.getByText("Notes", { exact: true }).click();
  await expect(panel.getByText("Fictional note only", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Delete goal Fictional holiday", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel goal deletion", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Confirm goal deletion" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Delete goal Fictional holiday", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm goal deletion", exact: true }).click();
  await expect(page.getByRole("article", { name: "Savings at a glance" })).toContainText("No savings goals yet.");
});

test("category and merchant rule create, edit, cancel, enabled, reclassify and delete controls work", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Manage categories and rules", exact: true }).click();
  const panel = page.getByRole("region", { name: "Categories and rules" });
  await panel.getByLabel("Category name").fill("Fictional Travel");
  await panel.getByLabel("Category type").selectOption("expense");
  await panel.getByLabel("Category colour").fill("#336699");
  await panel.getByRole("button", { name: "Save category", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Category saved.");
  expect(await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "save_category").slice(-1)[0].args.input))
    .toMatchObject({ color: "#336699" });
  await panel.getByRole("button", { name: "Edit Fictional Travel", exact: true }).click();
  await expect(panel.getByLabel("Category type")).toBeDisabled();
  await panel.getByRole("button", { name: "Cancel category edit", exact: true }).click();
  await expect(panel.getByLabel("Category name")).toHaveValue("");
  await panel.getByRole("button", { name: "Edit Fictional Travel", exact: true }).click();
  await panel.getByLabel("Category name").fill("Fictional Trips");
  await panel.getByRole("button", { name: "Save category", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit Fictional Trips", exact: true })).toBeVisible();
  await panel.getByLabel("Merchant pattern").fill("Fictional Merchant");
  await panel.getByLabel("Match method").selectOption("contains");
  await panel.getByLabel("Rule category").selectOption({ label: "Fictional Trips (expense)" });
  await panel.getByLabel("Priority").fill("50");
  await panel.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit rule fictional merchant", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Edit rule fictional merchant", exact: true }).click();
  await panel.getByLabel("Match method").selectOption("exact");
  await panel.getByLabel("Rule enabled").uncheck();
  await panel.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(panel.getByText(/Priority 50 · Disabled/)).toBeVisible();
  await panel.getByRole("button", { name: "Edit rule fictional merchant", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel rule edit", exact: true }).click();
  await expect(panel.getByLabel("Merchant pattern")).toHaveValue("");
  await panel.getByRole("button", { name: "Reclassify automatic transactions", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Manual choices preserved.");
  await panel.getByRole("button", { name: "Delete rule fictional merchant", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel deletion", exact: true }).click();
  await panel.getByRole("button", { name: "Delete rule fictional merchant", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit rule fictional merchant", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Delete Fictional Trips", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit Fictional Trips", exact: true })).toHaveCount(0);
});

test("private export consent, backup validation, failed restore and successful restore refresh work", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Private export and backup", exact: true }).click();
  const panel = page.getByRole("region", { name: "Private export and backup" });
  await panel.getByText("Local file locations", { exact: true }).click();
  await expect(panel.getByText("/fictional/private-backups", { exact: true })).toBeVisible();
  await panel.getByText("CSV format", { exact: true }).click();
  await expect(panel.getByText(/UTF-8 with BOM/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Export scoped CSV", exact: true })).toBeDisabled();
  await panel.getByLabel("Export account").selectOption("1");
  await panel.getByLabel("Export category").selectOption("1");
  await panel.getByLabel("Export type").selectOption("expense");
  await panel.getByLabel("Export search").fill("Fictional");
  await panel.getByLabel("Export from (inclusive)").fill("2024-02-01");
  await panel.getByLabel("Export through (inclusive)").fill("2024-02-15");
  await panel.getByLabel("I understand this writes sensitive transactions to an unencrypted CSV file.").check();
  await panel.getByRole("button", { name: "Export scoped CSV", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("This CSV is plaintext");
  await expect(panel.getByRole("button", { name: "Export scoped CSV", exact: true })).toBeDisabled();
  await panel.getByLabel("Backup passphrase", { exact: true }).fill("fictional backup passphrase");
  await panel.getByLabel("Confirm backup passphrase", { exact: true }).fill("fictional wrong confirmation");
  await panel.getByRole("button", { name: "Create encrypted backup", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("match");
  await panel.getByLabel("Confirm backup passphrase", { exact: true }).fill("fictional backup passphrase");
  await panel.getByRole("button", { name: "Create encrypted backup", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("/fictional/private-backups/test.ppbackup");
  await expect(panel.getByLabel("Backup passphrase", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByRole("button", { name: "Close transaction form", exact: true }).click();
  await addExpense(page, "Fictional post-backup expense");
  await panel.getByLabel("Local backup file path").fill("/fictional/private-backups/test.ppbackup");
  await panel.getByLabel("Restore backup passphrase").fill("fictional incorrect passphrase");
  await expect(panel.getByRole("button", { name: "Validate and restore backup", exact: true })).toBeDisabled();
  await panel.getByLabel(/Replace all current accounts/).check();
  await panel.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await panel.getByRole("button", { name: "Validate and restore backup", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Existing data was not replaced.");
  await expect(page.getByText("Fictional post-backup expense", { exact: true })).toBeVisible();
  await panel.getByLabel("Restore backup passphrase").fill("fictional backup passphrase");
  await panel.getByRole("button", { name: "Validate and restore backup", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("/fictional/private-backups/safety.ppbackup");
  await expect(page.getByText("Fictional post-backup expense", { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("Restore backup passphrase")).toHaveValue("");
  await expect(panel.getByRole("button", { name: "Validate and restore backup", exact: true })).toBeDisabled();
});

test("failed locks stay visible, retry succeeds and unlock keeps financial records", async ({ page }) => {
  await home(page);
  await page.evaluate(() => window.__pennyTest.failNext("lock_workspace", "Could not lock workspace."));
  await page.getByRole("button", { name: "Lock workspace", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not lock workspace.");
  await expect(page.getByRole("heading", { name: "Financial overview" })).toBeVisible();
  await page.getByRole("button", { name: "Lock workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unlock your workspace" })).toBeVisible();
  await page.getByLabel("Passphrase", { exact: true }).fill("fictional workspace passphrase");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText("Fictional Merchant 16", { exact: true })).toBeVisible();
});

test("failed requests have real retries and mutations do not falsely report success", async ({ page }) => {
  await home(page);
  await page.evaluate(() => window.__pennyTest.failNext("list_category_rules", "Rules could not be loaded.", 2));
  await page.getByRole("button", { name: "Manage categories and rules", exact: true }).click();
  const panel = page.getByRole("region", { name: "Categories and rules" });
  await expect(panel.getByRole("alert")).toContainText("Rules could not be loaded.");
  await expect(panel.getByRole("button", { name: "Reclassify automatic transactions", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Retry rules", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Reclassify automatic transactions", exact: true })).toBeEnabled();
  await page.evaluate(() => window.__pennyTest.failNext("delete_category", "Category is in use."));
  await panel.getByRole("button", { name: "Delete Fictional Food", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Category is in use.");
  await expect(panel.getByRole("button", { name: "Edit Fictional Food", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Cancel deletion", exact: true }).click();
});

test("dashboard and planning retries recover without showing missing history as success", async ({ page }) => {
  await home(page);
  await page.evaluate(() => {
    window.__pennyTest.failNext("list_finance_data", "Finance unavailable.");
    window.__pennyTest.failNext("list_budgets", "Budget overview unavailable.");
    window.__pennyTest.failNext("list_savings_goals", "Savings overview unavailable.");
  });
  await page.getByRole("textbox", { name: "Dashboard month", exact: true }).fill("2024-01");
  await expect(page.getByRole("alert").filter({ hasText: "Finance unavailable." })).toBeVisible();
  await expect(page.getByRole("article", { name: "Budget check-in" }).getByRole("alert")).toContainText("Budget overview unavailable.");
  await page.getByRole("button", { name: "Retry budget overview", exact: true }).click();
  await expect(page.getByRole("article", { name: "Budget check-in" }).getByText("No budgets this month.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Finance unavailable." })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Savings at a glance" }).getByRole("alert")).toContainText("Savings overview unavailable.");
  await page.getByRole("button", { name: "Retry savings overview", exact: true }).click();
  await expect(page.getByRole("article", { name: "Savings at a glance" }).getByText("No savings goals yet.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__pennyTest.failNext("list_budgets", "Budget editor unavailable.", 2));
  await page.getByRole("button", { name: "Manage budgets", exact: true }).click();
  const budgets = page.getByRole("region", { name: "Monthly category budgets" });
  await expect(budgets.getByRole("alert")).toContainText("Budget editor unavailable.");
  await budgets.getByRole("button", { name: "Retry budgets", exact: true }).click();
  await expect(budgets.getByText("No budgets this month.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__pennyTest.failNext("list_savings_goals", "Goal editor unavailable.", 2));
  await page.getByRole("button", { name: "Manage goals", exact: true }).click();
  const goals = page.getByRole("region", { name: "Savings goals", exact: true });
  await expect(goals.getByRole("alert")).toContainText("Goal editor unavailable.");
  await goals.getByRole("button", { name: "Retry goals", exact: true }).click();
  await expect(goals.getByText("No savings goals yet.", { exact: true })).toBeVisible();
});

test("pending transaction saves disable duplicate submits and close, then recalculate spending", async ({ page }) => {
  await home(page);
  await page.evaluate(() => window.__pennyTest.hold("create_transaction"));
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Amount (GBP)", { exact: true }).fill("12.34");
  await page.getByLabel("Description", { exact: true }).fill("Fictional pending expense");
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close transaction form" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "create_transaction").length)).toBe(1);
  await page.evaluate(() => window.__pennyTest.release("create_transaction"));
  await expect(page.getByText("Fictional pending expense", { exact: true })).toBeVisible();
  const summary = page.getByRole("region", { name: "2024-02 financial summary" });
  await expect(summary.getByRole("article").filter({ has: page.getByText("Spending", { exact: true }) })).toContainText("£136.34");
  await expect(summary.getByRole("article").filter({ has: page.getByText("Net cash flow", { exact: true }) })).toContainText("-£134.34");
});

test.describe("initial loading and failure", () => {
  test.use({ blockedCommand: "list_finance_data" });
  test("loading stays explicit and a failed initial load has a working retry", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("Loading your encrypted financial data");
    await expect(page.getByRole("heading", { name: "Financial overview" })).toHaveCount(0);
    await page.evaluate(() => {
      window.__pennyTest.failNext("list_finance_data", "Initial finance unavailable.", 2);
      window.__pennyTest.release("list_finance_data");
    });
    await expect(page.getByRole("alert")).toContainText("Initial finance unavailable.");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("Fictional Merchant 16", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("workspace status retry", () => {
  test.use({ blockedCommand: "workspace_status" });
  test("Try again recovers a failed workspace check", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.__pennyTest.failNext("workspace_status", "Workspace check unavailable.", 2);
      window.__pennyTest.release("workspace_status");
    });
    await expect(page.getByRole("alert")).toContainText("Workspace check unavailable.");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Financial overview" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("new workspace controls", () => {
  test.use({ startStatus: "new" });
  test("required fields, passphrase validation and creation work", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create secure workspace", exact: true }).click();
    expect(await page.getByLabel("Passphrase", { exact: true }).evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(true);
    await page.getByLabel("Passphrase", { exact: true }).fill("short");
    await page.getByLabel("Confirm passphrase", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Create secure workspace", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("12");
    await page.getByLabel("Passphrase", { exact: true }).fill("fictional new workspace passphrase");
    await page.getByLabel("Confirm passphrase", { exact: true }).fill("fictional new workspace passphrase");
    await page.getByRole("button", { name: "Create secure workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Financial overview" })).toBeVisible();
    await expect(page.getByText("No transactions this month.", { exact: true })).toBeVisible();
  });
});

test.describe("locked workspace controls", () => {
  test.use({ startStatus: "locked" });
  test("unlock error, recovery navigation, back and recovery work", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Passphrase", { exact: true }).fill("fictional wrong passphrase");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Incorrect passphrase.");
    await page.getByRole("button", { name: "Forgot your passphrase? Recover on this device", exact: true }).click();
    await page.getByRole("button", { name: "Back to unlock", exact: true }).click();
    await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Forgot your passphrase? Recover on this device", exact: true }).click();
    await page.getByLabel("New passphrase", { exact: true }).fill("fictional recovered workspace passphrase");
    await page.getByLabel("Confirm passphrase", { exact: true }).fill("fictional recovered workspace passphrase");
    await page.getByRole("button", { name: "Recover and continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Financial overview" })).toBeVisible();
  });
});
