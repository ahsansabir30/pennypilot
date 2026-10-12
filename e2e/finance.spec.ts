import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function home(page: Page) {
  await page.goto("/#/transactions");
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Fictional Merchant 16", exact: true })).toBeVisible();
}

async function navigate(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Workspace pages" }).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeFocused();
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

test("enabled page and popup buttons change colour on hover without changing disabled controls", async ({ page }) => {
  await home(page);
  async function expectHoverChange(button: ReturnType<Page["getByRole"]>) {
    await page.mouse.move(0, 0);
    const before = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
    await button.hover();
    expect(await button.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before);
  }
  await expectHoverChange(page.getByRole("button", { name: "Add transaction", exact: true }));
  await expectHoverChange(page.getByRole("button", { name: "Delete Fictional Merchant 16", exact: true }));
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add transaction", exact: true });
  await expectHoverChange(dialog.getByRole("button", { name: "Save transaction", exact: true }));
  await expectHoverChange(dialog.getByRole("button", { name: "Cancel transaction", exact: true }));
  await expectHoverChange(dialog.getByRole("button", { name: "Close Add transaction", exact: true }));
  await page.evaluate(() => window.__pennyTest.hold("create_transaction"));
  await dialog.getByLabel("Description", { exact: true }).fill("Fictional hover test");
  await dialog.getByLabel("Amount (GBP)", { exact: true }).fill("1.00");
  await dialog.getByRole("button", { name: "Save transaction", exact: true }).click();
  const disabledCancel = dialog.getByRole("button", { name: "Cancel transaction", exact: true });
  await expect(disabledCancel).toBeDisabled();
  await page.mouse.move(0, 0);
  const before = await disabledCancel.evaluate((element) => getComputedStyle(element).backgroundColor);
  await disabledCancel.hover();
  expect(await disabledCancel.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(before);
  await page.evaluate(() => window.__pennyTest.release("create_transaction"));
  await expect(dialog).toHaveCount(0);
});

const popupEditors = [
  { page: "Transactions", add: "Add transaction", field: "Description", value: "Fictional popup expense", amount: "Amount (GBP)", save: "Save transaction", command: "create_transaction" },
  { page: "Budgets", add: "Add budget", field: "Monthly limit (GBP)", value: "200.01", select: "Budget category", save: "Save monthly budget", command: "save_budget" },
  { page: "Savings", add: "Add savings goal", field: "Goal name", value: "Fictional popup goal", amount: "Target (GBP)", save: "Save savings goal", command: "save_savings_goal" },
  { page: "Categories & Rules", add: "Add category", field: "Category name", value: "Fictional popup category", save: "Save category", command: "save_category" },
  { page: "Categories & Rules", add: "Add rule", field: "Merchant pattern", value: "Fictional popup merchant", select: "Rule category", save: "Save rule", command: "save_category_rule" },
];

for (const editor of popupEditors) {
  test(`${editor.add} popup traps focus, retains failed saves and blocks closing while saving`, async ({ page }, testInfo) => {
    await home(page);
    if (editor.page !== "Transactions") await navigate(page, editor.page);
    const trigger = page.getByRole("button", { name: editor.add, exact: true });
    const header = trigger.locator("..");
    const headerBounds = await header.boundingBox();
    const triggerBounds = await trigger.boundingBox();
    expect(headerBounds).not.toBeNull();
    expect(triggerBounds).not.toBeNull();
    expect(Math.abs(headerBounds!.x + headerBounds!.width - triggerBounds!.x - triggerBounds!.width)).toBeLessThanOrEqual(1);
    await expect(page.getByLabel(editor.field, { exact: true })).toHaveCount(0);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: editor.add, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const select of await dialog.getByRole("combobox").all()) {
      expect((await select.boundingBox())?.height).toBe(48);
      expect(await select.evaluate((element) => getComputedStyle(element).appearance)).toBe("none");
    }
    for (const input of await dialog.locator('input:not([type="checkbox"]):not([type="color"]), .budget-amount-input').all()) {
      if (await input.evaluate((element) => element.matches(".budget-amount-input input"))) continue;
      expect((await input.boundingBox())?.height).toBe(48);
    }
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const first = dialog.getByRole("button", { name: `Close ${editor.add}`, exact: true });
    const cancel = dialog.getByRole("button", { name: /^Cancel/ });
    await expect(cancel).toHaveText("Cancel");
    await expect(dialog.getByRole("button", { name: editor.save, exact: true })).toHaveText("Save");
    await cancel.focus();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cancel).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Workspace pages" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByLabel(editor.field, { exact: true }).fill(editor.value);
    if (editor.amount) await dialog.getByLabel(editor.amount, { exact: true }).fill("10.01");
    if (editor.select) await dialog.getByRole("combobox", { name: editor.select, exact: true }).selectOption("1");
    await page.screenshot({ path: testInfo.outputPath("popup.png"), fullPage: true });
    await page.evaluate((command) => window.__pennyTest.failNext(command, "Fictional popup save failed."), editor.command);
    await dialog.getByRole("button", { name: editor.save, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Fictional popup save failed.");
    await expect(dialog.getByLabel(editor.field, { exact: true })).toHaveValue(editor.value);
    await expect(dialog).toBeVisible();

    await page.evaluate((command) => window.__pennyTest.hold(command), editor.command);
    await dialog.getByRole("button", { name: editor.save, exact: true }).click();
    await expect(first).toBeDisabled();
    await expect(cancel).toBeDisabled();
    await expect(dialog.getByLabel(editor.field, { exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate((command) => window.__pennyTest.calls.filter((call) => call.command === command).length, editor.command)).toBe(2);
    await page.evaluate((command) => window.__pennyTest.release(command), editor.command);
    await expect(dialog).toHaveCount(0);
    if (editor.page === "Transactions" || editor.page === "Categories & Rules") {
      await expect(page.getByRole("heading", { name: editor.page, level: 1 })).toBeFocused();
    }
    else await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByLabel(editor.field, { exact: true })).toHaveValue("");
    await cancel.click();
    await expect(dialog).toHaveCount(0);
  });
}

async function saveFoodBudget(page: Page) {
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  await page.getByRole("combobox", { name: "Budget category", exact: true }).selectOption("1");
  await page.getByLabel("Monthly limit (GBP)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  await expect(page.getByRole("button", { name: "View transactions for Fictional Food", exact: true })).toBeVisible();
}

test("categories and rules stack vertically with independent search and combined filters", async ({ page }) => {
  await home(page);
  await navigate(page, "Categories & Rules");
  const categories = page.getByRole("list", { name: "Categories", exact: true });
  const categoryBounds = await categories.boundingBox();
  const rulesHeading = await page.getByRole("heading", { name: "Merchant rules", exact: true }).boundingBox();
  expect(categoryBounds).not.toBeNull();
  expect(rulesHeading!.y).toBeGreaterThan(categoryBounds!.y + categoryBounds!.height);
  await page.getByLabel("Search categories", { exact: true }).fill(" FOOD ");
  await expect(categories.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Category filter", exact: true }).selectOption("income");
  await expect(page.getByText("No matching categories.", { exact: true })).toBeVisible();
  await page.getByLabel("Search categories", { exact: true }).fill("");
  await expect(categories).toContainText("Fictional Salary");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Merchant pattern", { exact: true }).fill("Fictional Market");
  await page.getByRole("combobox", { name: "Rule category", exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Search rules", { exact: true }).fill(" FOOD ");
  const rules = page.getByRole("list", { name: "Merchant rules", exact: true });
  await expect(rules).toContainText("fictional market");
  await page.getByRole("combobox", { name: "Rule status", exact: true }).selectOption("disabled");
  await expect(rules).toContainText("No matching rules.");
  await page.getByRole("combobox", { name: "Rule status", exact: true }).selectOption("enabled");
  await page.getByRole("combobox", { name: "Rule category filter", exact: true }).selectOption("2");
  await expect(rules).toContainText("No matching rules.");
  await page.getByRole("combobox", { name: "Rule category filter", exact: true }).selectOption("1");
  await expect(page.getByRole("button", { name: "Edit rule fictional market", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "reclassify_transactions").length)).toBe(0);
});

test("budget drilldown paginates exact elapsed category spending with signed refunds and manual corrections", async ({ page }, testInfo) => {
  await home(page);
  await navigate(page, "Categories & Rules");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Category name").fill("Fictional Travel");
  await page.getByRole("button", { name: "Save category", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Fictional Travel", exact: true })).toBeVisible();
  await navigate(page, "Transactions");
  for (const [date, category, merchant] of [
    ["2024-01-31", "1", "Fictional prior month"],
    ["2024-03-01", "1", "Fictional next month"],
    ["2024-02-15", "3", "Fictional other category"],
  ]) {
    await page.getByRole("button", { name: "Add transaction", exact: true }).click();
    await page.getByLabel("Amount (GBP)", { exact: true }).fill("1.01");
    await page.getByLabel("Transaction date", { exact: true }).fill(date);
    await page.getByRole("combobox", { name: "Category", exact: true }).selectOption(category);
    await page.getByLabel("Description", { exact: true }).fill("Fictional scope boundary");
    await page.getByLabel("Merchant optional", { exact: true }).fill(merchant);
    await page.getByRole("button", { name: "Save transaction", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add transaction", exact: true })).toBeEnabled();
  }
  await page.getByRole("button", { name: "Edit category for Fictional Merchant 15", exact: true }).click();
  await page.getByRole("combobox", { name: "Category for Fictional Merchant 15", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Save category choice" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await navigate(page, "Budgets");
  await saveFoodBudget(page);
  await expect(page.getByText("£93.00 used / £100.00 limit", { exact: true })).toBeVisible();
  const trigger = page.getByRole("button", { name: "View transactions for Fictional Food", exact: true });
  await expect(trigger).toHaveText("");
  const categoryTitle = await page.getByRole("heading", { name: "Fictional Food", exact: true }).boundingBox();
  await page.mouse.click(categoryTitle!.x + categoryTitle!.width / 2, categoryTitle!.y + categoryTitle!.height / 2);
  const dialog = page.getByRole("dialog", { name: "Fictional Food budget transactions", exact: true });
  const rows = dialog.getByRole("list", { name: "Budget transactions", exact: true }).getByRole("listitem");
  await expect(rows).toHaveCount(10);
  await expect(dialog.getByRole("status")).toHaveText("1–10 of 12 transactions");
  expect(await rows.locator("div > strong").allTextContents()).toEqual(
    [14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map((id) => `Fictional Merchant ${id}`));
  for (const excluded of ["Fictional Merchant 16", "Fictional Merchant 15", "Fictional Merchant 2", "Fictional Merchant 4",
    "Fictional prior month", "Fictional next month", "Fictional other category"]) {
    await expect(dialog.getByText(excluded, { exact: true })).toHaveCount(0);
  }
  // First page: 14 down through 5; second page: refund 3 and expense 1.
  await expect(rows.filter({ hasText: "Fictional Merchant 14" })).toContainText("£14.00");
  await expect(dialog.getByText(/through|Current category choices|Recorded activity only/)).toHaveCount(0);
  for (const label of ["Previous transactions", "Next transactions"]) {
    const arrow = dialog.getByRole("button", { name: label, exact: true });
    await expect(arrow).toHaveText("");
    const bounds = await arrow.boundingBox();
    expect(bounds?.width).toBe(44);
    expect(bounds?.height).toBe(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("budget-transactions.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Next transactions" }).click();
  await expect(rows).toHaveCount(2);
  expect(await rows.locator("div > strong").allTextContents()).toEqual(["Fictional Merchant 3", "Fictional Merchant 1"]);
  await expect(rows.filter({ hasText: "Fictional Merchant 3" })).toContainText("Refund");
  await expect(dialog.getByText(/Manual category/)).toHaveCount(0);
  await expect(rows.filter({ hasText: "Fictional Merchant 3" })).toContainText("-£3.00");
  await expect(dialog.getByText("Fictional Merchant 1", { exact: true })).toBeVisible();
  for (const excluded of ["Fictional Merchant 2", "Fictional Merchant 4", "Fictional prior month", "Fictional next month", "Fictional other category"]) {
    await expect(dialog.getByText(excluded, { exact: true })).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath("budget-refund.png"), fullPage: true });
  await expect(dialog.getByRole("button", { name: "Next transactions" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Previous transactions" }).click();
  await expect(rows).toHaveCount(10);
  await dialog.getByRole("button", { name: "Close transactions", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await trigger.press("Space");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  const filter = await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "list_transactions").at(-1)?.args.filter);
  expect(filter).toEqual({ month: "2024-02", categoryId: 1, kind: "spending", throughDate: "2024-02-15", search: "", sort: "date_desc", page: 0, pageSize: 10 });
});

test("budget drilldown supports loading dismissal, failure retry and clean reopening", async ({ page }) => {
  await home(page);
  await navigate(page, "Budgets");
  await saveFoodBudget(page);
  const trigger = page.getByRole("button", { name: "View transactions for Fictional Food", exact: true });
  await page.evaluate(() => window.__pennyTest.hold("list_transactions"));
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Fictional Food budget transactions" });
  await expect(dialog.getByRole("status")).toHaveText("Loading budget transactions...");
  await expect(dialog.getByRole("button", { name: "Close transactions", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.evaluate(() => window.__pennyTest.release("list_transactions"));
  await page.evaluate(() => window.__pennyTest.failNext("list_transactions", "Fictional drilldown unavailable."));
  await trigger.click();
  await expect(dialog.getByRole("alert")).toContainText("Fictional drilldown unavailable.");
  await expect(dialog.getByRole("list")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Retry budget transactions" }).click();
  await expect(dialog.getByRole("list", { name: "Budget transactions", exact: true }).getByRole("listitem")).toHaveCount(10);
  await dialog.getByRole("button", { name: "Next transactions" }).click();
  await expect(dialog.getByRole("status")).toHaveText("11–13 of 13 transactions");
  await dialog.getByRole("button", { name: "Close Fictional Food budget transactions", exact: true }).click();
  await trigger.click();
  await expect(dialog.getByRole("status")).toHaveText("1–10 of 13 transactions");
  await page.keyboard.press("Escape");
});

test("future budget drilldown is explicitly empty without requesting whole-month transactions", async ({ page }) => {
  await home(page);
  await navigate(page, "Budgets");
  await page.getByLabel("Dashboard month", { exact: true }).fill("2024-03");
  await expect(page.getByText("No budgets this month.", { exact: true })).toBeVisible();
  await saveFoodBudget(page);
  const count = await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "list_transactions").length);
  await page.getByRole("button", { name: "View transactions for Fictional Food", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Fictional Food budget transactions" });
  await expect(dialog.getByText("No spending yet this month.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("list")).toHaveCount(0);
  expect(await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "list_transactions").length)).toBe(count);
  await dialog.getByRole("button", { name: "Close transactions", exact: true }).click();
});

test("past budget drilldown includes persisted leap-day refunds through calendar month end", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("refund");
  await page.getByLabel("Amount (GBP)", { exact: true }).fill("1.01");
  await page.getByLabel("Transaction date", { exact: true }).fill("2024-02-29");
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("1");
  await page.getByLabel("Description", { exact: true }).fill("Fictional leap-day refund");
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2024-03-15T12:00:00Z"));
  await navigate(page, "Budgets");
  await saveFoodBudget(page);
  await expect(page.getByText("£122.99 used / £100.00 limit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View transactions for Fictional Food", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Fictional Food budget transactions" });
  await expect(dialog.getByText(/2024-02-01 through 2024-02-29/)).toHaveCount(0);
  const refund = dialog.getByRole("listitem").filter({ hasText: "Fictional leap-day refund" });
  await expect(refund).toContainText("-£1.01");
  await expect(refund).toContainText("2024-02-29 · Refund");
  await expect(dialog.getByRole("status")).toHaveText("1–10 of 15 transactions");
  await dialog.getByRole("button", { name: "Close transactions", exact: true }).click();
});

test("transaction category popup only persists deliberate saves and retains failed changes", async ({ page }) => {
  await home(page);
  const trigger = page.getByRole("button", { name: "Edit category for Fictional Merchant 16", exact: true });
  await expect(trigger).toHaveText("Fictional Food");
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  const dialog = page.getByRole("dialog", { name: "Edit transaction category" });
  await trigger.click();
  await expect(dialog.getByRole("button", { name: "Save category choice" })).toHaveText("Save");
  await expect(dialog.getByRole("button", { name: "Cancel category choice" })).toHaveText("Cancel");
  await dialog.getByLabel("Category for Fictional Merchant 16", { exact: true }).selectOption("");
  await dialog.getByRole("button", { name: "Cancel category choice" }).click();
  await expect(trigger).toContainText("Fictional Food");
  expect(await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "update_transaction_category").length)).toBe(0);
  await trigger.click();
  await dialog.getByLabel("Category for Fictional Merchant 16", { exact: true }).selectOption("");
  await page.evaluate(() => window.__pennyTest.failNext("update_transaction_category", "Fictional category update failed."));
  await dialog.getByRole("button", { name: "Save category choice" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Fictional category update failed.");
  await expect(dialog.getByLabel("Category for Fictional Merchant 16", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Save category choice" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toContainText("Uncategorised");
});

test("planning and settings layouts keep concise actions and expandable safeguards usable", async ({ page }, testInfo) => {
  await home(page);
  await navigate(page, "Budgets");
  await expect(page.getByRole("heading", { name: "Monthly limits", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  await page.getByRole("combobox", { name: "Budget category", exact: true }).selectOption("1");
  await page.getByLabel("Monthly limit (GBP)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save monthly budget" }).click();
  await expect(page.getByRole("button", { name: "Edit budget for Fictional Food" })).toBeVisible();
  await expect(page.getByText("Period details", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Calculation details", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Recorded spending, not complete bank history|Expenses less refunds; transfers and income excluded/)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Comparison period" })).toHaveCount(0);

  async function checkLayout(name: string) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const button of await page.locator(".management-heading button, .management-row-actions button, .budget-row-actions button, .rules-apply button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
  await checkLayout("budgets");
  await navigate(page, "Overview");
  const budgetPreview = page.getByRole("article", { name: "Budgets", exact: true });
  await expect(page.getByText("Recorded activity · GBP. Net cash flow is not an account balance.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Expenses less refunds", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Refunds offset their original category", { exact: true })).toHaveCount(0);
  await expect(budgetPreview).toContainText("£108.00 of £100.00");
  await expect(budgetPreview.getByText("1 category", { exact: true })).toBeVisible();
  const budgetTitle = await budgetPreview.getByRole("heading", { name: "Budgets", exact: true }).boundingBox();
  const categoryCount = await budgetPreview.getByText("1 category", { exact: true }).boundingBox();
  expect(categoryCount!.x).toBe(budgetTitle!.x);
  expect(categoryCount!.y - budgetTitle!.y - budgetTitle!.height).toBeLessThanOrEqual(8);
  await expect(budgetPreview.getByText("1 over limit", { exact: true })).toBeVisible();
  await expect(budgetPreview.getByText(/Recorded through|history may be incomplete|Expenses less refunds/)).toHaveCount(0);
  const previewRow = budgetPreview.getByRole("listitem");
  const progressBounds = await previewRow.getByRole("progressbar").boundingBox();
  const rowBounds = await previewRow.boundingBox();
  expect(progressBounds!.x).toBeGreaterThan(rowBounds!.x);
  expect(progressBounds!.x + progressBounds!.width).toBeLessThan(rowBounds!.x + rowBounds!.width);
  await checkLayout("overview");
  await navigate(page, "Savings");
  await expect(page.getByRole("heading", { name: "Your goals", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add savings goal", exact: true }).click();
  await page.getByLabel("Goal name").fill("Fictional rainy day");
  await page.getByLabel("Target (GBP)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save savings goal" }).click();
  const editGoal = page.getByRole("button", { name: "Edit goal Fictional rainy day" });
  await expect(editGoal).toHaveText("Edit");
  await expect(page.getByText("Calculation details", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/not a bank balance|No completion predicted|No target date/)).toHaveCount(0);
  await editGoal.click();
  await expect(page.getByRole("dialog", { name: "Edit savings goal" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editGoal).toBeFocused();
  await checkLayout("savings");
  await navigate(page, "Overview");
  const savingsPreview = page.getByRole("article", { name: "Savings", exact: true });
  await expect(savingsPreview.getByText("Entered progress · Not a bank balance", { exact: true })).toHaveCount(0);
  await expect(savingsPreview.getByText("1 goal", { exact: true })).toBeVisible();
  await expect(savingsPreview.getByRole("listitem")).toContainText("£0.00 of £100.00");
  expect(await savingsPreview.getByRole("list").getAttribute("class")).toBe(await budgetPreview.getByRole("list").getAttribute("class"));
  await checkLayout("overview-savings");

  await navigate(page, "Categories & Rules");
  const categoriesHeading = await page.getByRole("heading", { name: "Categories", exact: true }).boundingBox();
  const rulesHeading = await page.getByRole("heading", { name: "Merchant rules", exact: true }).boundingBox();
  expect(categoriesHeading).not.toBeNull();
  expect(rulesHeading).not.toBeNull();
  expect(rulesHeading!.y).toBeGreaterThan(categoriesHeading!.y + categoriesHeading!.height);
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Merchant pattern").fill("Fictional Merchant");
  await page.getByRole("combobox", { name: "Rule category", exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  const editRule = page.getByRole("button", { name: "Edit rule fictional merchant", exact: true });
  await expect(editRule).toHaveText("Edit");
  await expect(page.getByText("How rules work", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Higher priority wins|Conflicting ties stay uncategorised/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply rules to automatic transactions" })).toHaveText("Apply rules");
  await editRule.click();
  await expect(page.getByRole("dialog", { name: "Edit rule", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  for (const list of await page.getByRole("list", { name: /^(Categories|Merchant rules)$/ }).all()) {
    expect(await list.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  }
  await checkLayout("categories");
});

test("transaction filters align and the category editor separates its label, field and actions", async ({ page }, testInfo) => {
  await home(page);
  const search = page.getByRole("textbox", { name: "Search transactions", exact: true });
  const searchBox = await search.evaluate((input) => {
    const bounds = input.closest("label")!.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, y: bounds.y };
  });
  for (const name of ["Filter by type", "Filter by category", "Sort transactions"]) {
    const filterBox = await page.getByRole("combobox", { name, exact: true }).boundingBox();
    expect(filterBox).not.toBeNull();
    expect(Math.abs(filterBox!.height - searchBox.height)).toBeLessThanOrEqual(1);
    if (testInfo.project.name === "desktop") {
      expect(Math.abs(filterBox!.width - searchBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(filterBox!.y - searchBox.y)).toBeLessThanOrEqual(1);
    }
  }
  await page.getByRole("combobox", { name: "Filter by type", exact: true }).selectOption("refund");
  await expect(page.getByText("Refunds reduce spending. Transfers are excluded from totals.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Fictional Merchant 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit category for Fictional Merchant 3", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit transaction category" });
  const labelBox = await dialog.getByText("Category", { exact: true }).boundingBox();
  const fieldBox = await dialog.getByRole("combobox").boundingBox();
  const saveBox = await dialog.getByRole("button", { name: "Save category choice" }).boundingBox();
  expect(labelBox).not.toBeNull();
  expect(fieldBox).not.toBeNull();
  expect(saveBox).not.toBeNull();
  expect(fieldBox!.y - (labelBox!.y + labelBox!.height)).toBeGreaterThanOrEqual(8);
  expect(saveBox!.y - (fieldBox!.y + fieldBox!.height)).toBeGreaterThanOrEqual(20);
  await expect(dialog.getByRole("combobox")).toHaveValue("1");
  await expect(dialog.getByRole("option", { name: /automatic|manual/i })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel category choice" }).click();
});

test("earliest accepted source date keeps dashboard and budgets usable without inferred comparison", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Amount (GBP)", { exact: true }).fill("1.23");
  await page.getByLabel("Transaction date", { exact: true }).fill("1000-01-01");
  await page.getByLabel("Category", { exact: true }).selectOption("1");
  await page.getByLabel("Description", { exact: true }).fill("Fictional earliest expense");
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await navigate(page, "Overview");
  await expect(page.getByRole("region", { name: "1000-01 financial summary" })).toContainText("£1.23");
  await expect(page.getByText(/History before January 1000 is unavailable/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Available income and spending trend", exact: true })).toBeVisible();
  await expect(page.locator(".trend-month")).toHaveCount(1);
  await page.getByRole("link", { name: "Set your first budget", exact: true }).click();
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  await page.getByRole("combobox", { name: "Budget category", exact: true }).selectOption("1");
  await page.getByLabel("Monthly limit (GBP)", { exact: true }).fill("10.00");
  await page.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  await expect(page.getByText("£1.23 used / £10.00 limit", { exact: true })).toBeVisible();
  await expect(page.getByText(/Previous period is outside the supported date range|no change inferred/)).toHaveCount(0);
  await expect(page.getByLabel("Comparison period", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test.describe("exact aggregate currency", () => {
  test.use({ largeAggregates: true });
  test("renders large dashboard, category and budget amounts without rounding pence", async ({ page }) => {
    await page.goto("/");
    const summary = page.getByRole("region", { name: "2024-02 financial summary" });
    await expect(summary).toContainText("£90,071,999,999,099.29");
    await expect(summary).toContainText("-£90,071,999,999,099.29");
    await expect(page.locator(".category-list")).toContainText("£90,071,999,999,099.29");
    await expect(page.locator(".trend-values")).toContainText("-£90,071,999,999,099.29");
    await page.getByRole("link", { name: "Set your first budget", exact: true }).click();
    await page.getByRole("button", { name: "Add budget", exact: true }).click();
    await page.getByRole("combobox", { name: "Budget category", exact: true }).selectOption("1");
    await page.getByLabel("Monthly limit (GBP)", { exact: true }).fill("100.00");
    await page.getByRole("button", { name: "Save monthly budget", exact: true }).click();
    await expect(page.getByText("£90,071,999,999,099.29 used / £100.00 limit", { exact: true })).toBeVisible();
    await expect(page.getByText("£90,071,999,998,999.29 over limit.", { exact: true })).toBeVisible();
    await navigate(page, "Overview");
    await expect(page.getByText("£90,071,999,998,999.29 over", { exact: true })).toBeVisible();
  });
});

test("overview previews and all dedicated workspace pages stay separate", async ({ page }) => {
  await page.goto("/");
  const summary = page.getByRole("region", { name: "2024-02 financial summary" });
  await expect(summary.getByRole("article").filter({ has: page.getByText("Income", { exact: true }) })).toContainText("£2.00");
  await expect(summary.getByRole("article").filter({ has: page.getByText("Spending", { exact: true }) })).toContainText("£124.00");
  await expect(summary.getByRole("article").filter({ has: page.getByText("Net cash flow", { exact: true }) })).toContainText("-£122.00");
  for (const title of ["Budgets", "Savings", "Monthly trend", "Spending by category", "Recorded transactions"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Add transaction", exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  for (const title of ["Budgets", "Savings"]) {
    const preview = page.getByRole("article", { name: title, exact: true });
    await expect(preview.getByRole("link")).toHaveCount(1);
    const text = await preview.getByText(title === "Savings" ? "No savings goals yet." : "No budgets this month.", { exact: true }).boundingBox();
    const action = await preview.getByRole("link").boundingBox();
    expect(text).not.toBeNull();
    expect(action).not.toBeNull();
    expect(action!.y - (text!.y + text!.height)).toBeGreaterThanOrEqual(16);
  }
  await page.getByRole("link", { name: "Set your first budget", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeFocused();
  await expect(page.getByRole("region", { name: "Budget and savings overview" })).toHaveCount(0);
  await navigate(page, "Overview");
  await page.getByRole("link", { name: "Create your first goal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Savings", level: 1 })).toBeFocused();
  for (const [name, region] of [
    ["Transactions", "Transactions"], ["Budgets", "Monthly category budgets"], ["Savings", "Savings goals"],
    ["Categories & Rules", "Categories and rules"], ["Export & Backup", "Private export and backup"],
  ]) {
    await navigate(page, name);
    await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: region, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /financial summary/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("all hash deep links load directly and unknown routes fall back to Overview", async ({ page }) => {
  for (const [route, name] of [
    ["overview", "Overview"], ["transactions", "Transactions"], ["budgets", "Budgets"],
    ["savings", "Savings"], ["categories", "Categories & Rules"], ["backup", "Export & Backup"],
  ]) {
    await page.goto(`/#/${route}`);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toHaveCount(route === "overview" ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/#/unknown");
  await expect(page).toHaveURL(/#\/overview$/);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});

test("browser back and forward restore pages, selected month and transaction filters", async ({ page }) => {
  await home(page);
  await page.getByRole("textbox", { name: "Search transactions", exact: true }).fill("Merchant 1");
  await expect(page.getByText("1–8 of 8", { exact: true })).toBeVisible();
  await page.getByLabel("Dashboard month").fill("2024-01");
  await expect(page.getByText("No transactions match these filters.", { exact: true })).toBeVisible();
  await navigate(page, "Budgets");
  await expect(page.getByLabel("Dashboard month")).toHaveValue("2024-01");
  await navigate(page, "Savings");
  await expect(page.getByLabel("Dashboard month")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeFocused();
  await expect(page.getByLabel("Dashboard month")).toHaveValue("2024-01");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Search transactions", exact: true })).toHaveValue("Merchant 1");
  await expect(page.getByText("No transactions match these filters.", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeFocused();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Budgets", exact: true })).toHaveAttribute("aria-current", "page");
});

test("transactions validate, close, save exact pence, preserve manual categories and confirm deletion", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  expect(await page.getByLabel("Amount (GBP)", { exact: true }).evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(true);
  await page.getByRole("button", { name: "Close Add transaction" }).click();
  await expect(page.getByRole("button", { name: "Save transaction", exact: true })).toHaveCount(0);
  await addExpense(page);
  const last = await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "create_transaction").slice(-1)[0]);
  expect(last.args.input).toMatchObject({ amountPence: 1234, transactionDate: "2024-02-15", categoryId: 1, manualCategory: true });
  const row = page.getByRole("row").filter({ has: page.getByText("Fictional Coffee Shop", { exact: true }) });
  await expect(row.getByText("Manual", { exact: true })).toHaveCount(0);
  await expect(row.getByText("Manual choice preserved.", { exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Edit category for Fictional Coffee Shop", exact: true }).click();
  const categoryDialog = page.getByRole("dialog", { name: "Edit transaction category" });
  await categoryDialog.getByRole("combobox", { name: "Category for Fictional Coffee Shop", exact: true }).selectOption("");
  await expect(categoryDialog.getByRole("combobox", { name: "Category for Fictional Coffee Shop", exact: true })).toHaveValue("");
  await categoryDialog.getByRole("button", { name: "Save category choice" }).click();
  await expect(categoryDialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Edit category for Fictional Coffee Shop", exact: true })).toContainText("Uncategorised");
  await row.getByRole("button", { name: "Edit category for Fictional Coffee Shop", exact: true }).click();
  await categoryDialog.getByRole("button", { name: "Use rules for Fictional Coffee Shop", exact: true }).click();
  await expect(categoryDialog).toHaveCount(0);
  await expect(row.getByText("Automatic", { exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Use rules for Fictional Coffee Shop", exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Edit category for Fictional Merchant 4", exact: true })).toHaveCount(0);
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
  await navigate(page, "Budgets");
  const panel = page.getByRole("region", { name: "Monthly category budgets" });
  await panel.getByRole("button", { name: "Add budget", exact: true }).click();
  await panel.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  expect(await panel.getByLabel("Budget category").evaluate((element: HTMLSelectElement) => element.validity.valueMissing)).toBe(true);
  await panel.getByLabel("Budget category").selectOption("1");
  await panel.getByLabel("Monthly limit (GBP)").fill("1.001");
  await panel.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("two decimal places");
  await panel.getByLabel("Monthly limit (GBP)").fill("500.01");
  await panel.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Budget saved for 2024-02.");
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await navigate(page, "Overview");
  await expect(page.getByRole("article", { name: "Budgets", exact: true })).toContainText("£500.01");
  await navigate(page, "Budgets");
  await panel.getByRole("button", { name: "Edit budget for Fictional Food", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Category budgets", includeHidden: true }).getByRole("listitem", { includeHidden: true })).toHaveCount(1);
  await expect(panel.getByRole("heading", { name: "Edit budget limit" })).toBeVisible();
  await expect(panel.getByLabel("Monthly limit (GBP)")).toBeFocused();
  await expect(panel.getByLabel("Monthly limit (GBP)")).toHaveValue("500.01");
  await panel.getByLabel("Monthly limit (GBP)").fill("250.01");
  await panel.getByRole("button", { name: "Save monthly budget", exact: true }).click();
  await expect(panel.getByText("£108.00 used / £250.01 limit", { exact: true })).toBeVisible();
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await panel.getByRole("button", { name: "Edit budget for Fictional Food", exact: true }).click();
  await expect(panel.getByLabel("Monthly limit (GBP)")).toHaveValue("250.01");
  await panel.getByRole("button", { name: "Cancel budget", exact: true }).click();
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await expect(panel.getByText(/2024-02-01 through 2024-02-15|No comparable category records/)).toHaveCount(0);
  await expect(panel.getByRole("combobox", { name: "Comparison period", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "save_budget_preferences").length)).toBe(0);
  await panel.getByRole("button", { name: "Remove budget for Fictional Food", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel budget removal", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Confirm budget removal" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Remove budget for Fictional Food", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm budget removal", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit budget for Fictional Food", exact: true })).toHaveCount(0);
});

test("multiple budgets remain separate list rows with an accessible responsive limit editor", async ({ page }, testInfo) => {
  await home(page);
  await navigate(page, "Categories & Rules");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Category name").fill("Fictional Travel");
  await page.getByLabel("Category type").selectOption("expense");
  await page.getByRole("button", { name: "Save category", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Category saved.");
  await navigate(page, "Budgets");
  for (const category of ["Fictional Food", "Fictional Travel"]) {
    await page.getByRole("button", { name: "Add budget", exact: true }).click();
    await page.getByLabel("Budget category").selectOption({ label: category });
    await page.getByLabel("Monthly limit (GBP)").fill("100.00");
    await page.getByRole("button", { name: "Save monthly budget", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edit budget for ${category}`, exact: true })).toBeVisible();
  }
  const list = page.getByRole("list", { name: "Category budgets" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const food = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Fictional Food", exact: true }) });
  const travel = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Fictional Travel", exact: true }) });
  const foodBox = await food.boundingBox();
  const travelBox = await travel.boundingBox();
  expect(foodBox).not.toBeNull();
  expect(travelBox).not.toBeNull();
  expect(travelBox!.y).toBeGreaterThanOrEqual(foodBox!.y + foodBox!.height - 1);
  await travel.getByRole("button", { name: "Edit budget for Fictional Travel", exact: true }).click();
  await expect(page.getByLabel("Budget category")).toHaveValue("3");
  await expect(page.getByLabel("Monthly limit (GBP)")).toBeFocused();
  const categoryBox = await page.getByLabel("Budget category").boundingBox();
  const limitBox = await page.getByLabel("Monthly limit (GBP)").boundingBox();
  expect(categoryBox).not.toBeNull();
  expect(limitBox).not.toBeNull();
  if (testInfo.project.name === "mobile") {
    expect(limitBox!.y).toBeGreaterThanOrEqual(categoryBox!.y + categoryBox!.height);
  }
  await page.getByRole("button", { name: "Cancel budget", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("savings add, invalid values, explicit progress, edit/cancel, notes and delete/cancel work", async ({ page }) => {
  await home(page);
  await navigate(page, "Savings");
  const panel = page.getByRole("region", { name: "Savings goals", exact: true });
  await panel.getByRole("button", { name: "Add savings goal", exact: true }).click();
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
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await panel.getByRole("button", { name: "Edit goal Fictional holiday", exact: true }).click();
  await panel.getByLabel("Entered progress (GBP)").fill("120");
  await panel.getByRole("button", { name: "Save savings goal", exact: true }).click();
  await navigate(page, "Overview");
  await expect(page.getByRole("article", { name: "Savings", exact: true })).toContainText("Target reached");
  await navigate(page, "Savings");
  await expect(panel.getByText("Calculation details", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("2028-02-29", { exact: true })).toBeVisible();
  await panel.getByText("Notes", { exact: true }).click();
  await expect(panel.getByText("Fictional note only", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Delete goal Fictional holiday", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel goal deletion", exact: true }).click();
  await expect(panel.getByRole("group", { name: "Confirm goal deletion" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Delete goal Fictional holiday", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm goal deletion", exact: true }).click();
  await navigate(page, "Overview");
  await expect(page.getByRole("article", { name: "Savings", exact: true })).toContainText("No savings goals yet.");
});

test("category and merchant rule create, edit, cancel, enabled, reclassify and delete controls work", async ({ page }) => {
  await home(page);
  await navigate(page, "Categories & Rules");
  const panel = page.getByRole("region", { name: "Categories and rules" });
  await panel.getByRole("button", { name: "Add category", exact: true }).click();
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
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await panel.getByRole("button", { name: "Edit Fictional Travel", exact: true }).click();
  await panel.getByLabel("Category name").fill("Fictional Trips");
  await panel.getByRole("button", { name: "Save category", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit Fictional Trips", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Add rule", exact: true }).click();
  await panel.getByLabel("Merchant pattern").fill("Fictional Merchant");
  await panel.getByLabel("Match method").selectOption("contains");
  await panel.getByRole("combobox", { name: "Rule category", exact: true }).selectOption({ label: "Fictional Trips (expense)" });
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
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await panel.getByRole("button", { name: "Apply rules to automatic transactions", exact: true }).click();
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
  await navigate(page, "Export & Backup");
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
  await panel.getByLabel("Backup passphrase", { exact: true }).fill("fictional unsaved passphrase");
  await panel.getByLabel("I understand this writes sensitive transactions to an unencrypted CSV file.").check();
  await navigate(page, "Transactions");
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByRole("button", { name: "Close Add transaction", exact: true }).click();
  await addExpense(page, "Fictional post-backup expense");
  await navigate(page, "Export & Backup");
  await expect(panel.getByLabel("Backup passphrase", { exact: true })).toHaveValue("");
  await expect(panel.getByLabel("I understand this writes sensitive transactions to an unencrypted CSV file.")).not.toBeChecked();
  await panel.getByLabel("Local backup file path").fill("/fictional/private-backups/test.ppbackup");
  await panel.getByLabel("Restore backup passphrase").fill("fictional incorrect passphrase");
  await expect(panel.getByRole("button", { name: "Validate and restore backup", exact: true })).toBeDisabled();
  await panel.getByLabel(/Replace all current accounts/).check();
  await panel.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await panel.getByRole("button", { name: "Validate and restore backup", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Existing data was not replaced.");
  await navigate(page, "Transactions");
  await expect(page.getByText("Fictional post-backup expense", { exact: true })).toBeVisible();
  await navigate(page, "Export & Backup");
  await panel.getByLabel("Local backup file path").fill("/fictional/private-backups/test.ppbackup");
  await panel.getByLabel(/Replace all current accounts/).check();
  await panel.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await panel.getByLabel("Restore backup passphrase").fill("fictional backup passphrase");
  await page.evaluate(() => {
    window.__pennyTest.hold("list_finance_data");
    window.__pennyTest.hold("list_transactions");
  });
  await panel.getByRole("button", { name: "Validate and restore backup", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("/fictional/private-backups/safety.ppbackup");
  await expect(page.getByRole("region", { name: /financial summary/ })).toHaveCount(0);
  await expect(page.getByText("Fictional post-backup expense", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.__pennyTest.failNext("list_finance_data", "Fictional restored summary unavailable.");
    window.__pennyTest.release("list_finance_data");
    window.__pennyTest.release("list_transactions");
  });
  await expect(page.getByRole("alert")).toContainText("Fictional restored summary unavailable.");
  await expect(page.getByRole("region", { name: /financial summary/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("/fictional/private-backups/safety.ppbackup");
  await expect(panel.getByLabel("Restore backup passphrase")).toHaveValue("");
  await expect(panel.getByRole("button", { name: "Validate and restore backup", exact: true })).toBeDisabled();
  await navigate(page, "Overview");
  await expect(page.getByRole("region", { name: "2024-02 financial summary" })).toContainText("£124.00");
  await navigate(page, "Transactions");
  await expect(page.getByText("Fictional post-backup expense", { exact: true })).toHaveCount(0);
});

test("failed locks stay visible, retry succeeds and unlock keeps financial records", async ({ page }) => {
  await home(page);
  await page.evaluate(() => window.__pennyTest.failNext("lock_workspace", "Could not lock workspace."));
  await page.getByRole("button", { name: "Lock workspace", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not lock workspace.");
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Lock workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unlock your workspace" })).toBeVisible();
  await page.getByLabel("Passphrase", { exact: true }).fill("fictional workspace passphrase");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText("Fictional Merchant 16", { exact: true })).toBeVisible();
});

test("failed requests have real retries and mutations do not falsely report success", async ({ page }) => {
  await home(page);
  await page.evaluate(() => window.__pennyTest.failNext("list_category_rules", "Rules could not be loaded."));
  await navigate(page, "Categories & Rules");
  const panel = page.getByRole("region", { name: "Categories and rules" });
  await expect(panel.getByRole("alert")).toContainText("Rules could not be loaded.");
  await expect(panel.getByRole("button", { name: "Apply rules to automatic transactions", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Retry rules", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply rules to automatic transactions", exact: true })).toBeEnabled();
  await page.evaluate(() => window.__pennyTest.failNext("delete_category", "Category is in use."));
  await panel.getByRole("button", { name: "Delete Fictional Food", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Category is in use.");
  await expect(panel.getByRole("button", { name: "Edit Fictional Food", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Cancel deletion", exact: true }).click();
});

test("dashboard and planning retries recover without showing missing history as success", async ({ page }) => {
  await home(page);
  await navigate(page, "Overview");
  await page.evaluate(() => {
    window.__pennyTest.failNext("list_finance_data", "Finance unavailable.");
    window.__pennyTest.failNext("list_budgets", "Budget overview unavailable.");
    window.__pennyTest.failNext("list_savings_goals", "Savings overview unavailable.");
  });
  await page.getByRole("textbox", { name: "Dashboard month", exact: true }).fill("2024-01");
  await expect(page.getByRole("alert").filter({ hasText: "Finance unavailable." })).toBeVisible();
  await expect(page.getByRole("region", { name: /financial summary/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Monthly trend", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Budgets", exact: true }).getByRole("alert")).toContainText("Budget overview unavailable.");
  await page.getByRole("button", { name: "Retry budget overview", exact: true }).click();
  await expect(page.getByRole("article", { name: "Budgets", exact: true }).getByText("No budgets this month.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Finance unavailable." })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Savings", exact: true }).getByRole("alert")).toContainText("Savings overview unavailable.");
  await page.getByRole("button", { name: "Retry savings overview", exact: true }).click();
  await expect(page.getByRole("article", { name: "Savings", exact: true }).getByText("No savings goals yet.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__pennyTest.failNext("list_budgets", "Budget editor unavailable."));
  await navigate(page, "Budgets");
  const budgets = page.getByRole("region", { name: "Monthly category budgets" });
  await expect(budgets.getByRole("alert")).toContainText("Budget editor unavailable.");
  await budgets.getByRole("button", { name: "Retry budgets", exact: true }).click();
  await expect(budgets.getByText("No budgets this month.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__pennyTest.failNext("list_savings_goals", "Goal editor unavailable."));
  await navigate(page, "Savings");
  const goals = page.getByRole("region", { name: "Savings goals", exact: true });
  await expect(goals.getByRole("alert")).toContainText("Goal editor unavailable.");
  await goals.getByRole("button", { name: "Retry goals", exact: true }).click();
  await expect(goals.getByText("No savings goals yet.", { exact: true })).toBeVisible();
});

test("pending month and filter requests hide stale figures and actionable transactions", async ({ page }) => {
  await home(page);
  await page.evaluate(() => {
    window.__pennyTest.hold("list_finance_data");
    window.__pennyTest.hold("list_transactions");
  });
  await page.getByLabel("Dashboard month", { exact: true }).fill("2024-01");
  await expect(page.getByText("Loading financial summary...", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /financial summary/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add transaction", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Delete Fictional Merchant/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByLabel("Dashboard month", { exact: true }).fill("2024-02");
  await page.evaluate(() => {
    window.__pennyTest.release("list_finance_data");
    window.__pennyTest.release("list_transactions");
  });
  await expect(page.getByRole("button", { name: "Delete Fictional Merchant 16", exact: true })).toBeVisible();
  await navigate(page, "Overview");
  await expect(page.getByRole("region", { name: "2024-02 financial summary" })).toContainText("£124.00");
  await navigate(page, "Transactions");
  await page.evaluate(() => {
    window.__pennyTest.hold("list_transactions");
    window.__pennyTest.failNext("list_transactions", "Fictional filter load failed.");
  });
  await page.getByRole("textbox", { name: "Search transactions", exact: true }).fill("Merchant 1");
  await expect(page.getByText("Loading transactions...", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Delete Fictional Merchant/ })).toHaveCount(0);
  await page.evaluate(() => window.__pennyTest.release("list_transactions"));
  await expect(page.getByRole("alert")).toContainText("Fictional filter load failed.");
  await expect(page.getByText("Records unavailable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete Fictional Merchant 16", exact: true })).toBeVisible();
});

test("production CSP actively blocks inline scripts and native form submission", async ({ page }) => {
  const response = await page.goto("/");
  if (!response) throw new Error("Expected a production document response.");
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("form-action 'none'");
  const probe = await page.context().newPage();
  try {
    await probe.route("http://127.0.0.1:1422/csp-probe", (route) => route.fulfill({
      contentType: "text/html", headers: { "content-security-policy": csp },
      body: "<!doctype html><html><body>CSP test document</body></html>",
    }));
    await probe.goto("http://127.0.0.1:1422/csp-probe");
    const result = await probe.evaluate(async () => {
      async function violation(trigger: () => void) {
        const event = new Promise<string>((resolve) => document.addEventListener("securitypolicyviolation",
          (event) => resolve(event.effectiveDirective), { once: true }));
        trigger();
        return event;
      }
      const scriptDirective = await violation(() => {
        const script = document.createElement("script");
        script.textContent = "document.body.dataset.executed = 'yes'";
        document.body.append(script);
      });
      const formDirective = await violation(() => {
        const form = document.createElement("form");
        form.action = "/blocked-native-submission";
        form.method = "post";
        document.body.append(form);
        form.submit();
      });
      return { scriptDirective, formDirective, executed: document.body.dataset.executed ?? null };
    });
    expect(result).toEqual({ scriptDirective: "script-src-elem", formDirective: "form-action", executed: null });
    expect(probe.url()).toBe("http://127.0.0.1:1422/csp-probe");
  } finally {
    await probe.close();
  }
});

test("failed refresh after deletion never retains old financial totals or rows", async ({ page }) => {
  await home(page);
  await page.evaluate(() => {
    window.__pennyTest.failNext("list_finance_data", "Fictional summary refresh failed.");
    window.__pennyTest.failNext("list_transactions", "Fictional transaction refresh failed.");
  });
  await page.getByRole("button", { name: "Delete Fictional Merchant 16", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Fictional summary refresh failed.");
  await expect(page.getByRole("button", { name: /^Delete Fictional Merchant/ })).toHaveCount(0);
  await navigate(page, "Overview");
  await expect(page.getByRole("region", { name: /financial summary/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("region", { name: "2024-02 financial summary" })).toContainText("£108.00");
  await navigate(page, "Transactions");
  await expect(page.getByRole("button", { name: "Delete Fictional Merchant 15", exact: true })).toBeVisible();
});

test("deleting the final page returns to remaining records without a false empty month", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (let id = 6; id >= 1; id--) {
    await page.getByRole("button", { name: `Delete Fictional Merchant ${id}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("button", { name: `Delete Fictional Merchant ${id}`, exact: true })).toHaveCount(0);
  }
  await expect(page.getByText("1–10 of 10", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Fictional Merchant 16", exact: true })).toBeVisible();
  await expect(page.getByText("No transactions this month.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
});

test("pending transaction saves disable duplicate submits and close, then recalculate spending", async ({ page }) => {
  await home(page);
  await page.evaluate(() => window.__pennyTest.hold("create_transaction"));
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Amount (GBP)", { exact: true }).fill("12.34");
  await page.getByLabel("Description", { exact: true }).fill("Fictional pending expense");
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save transaction", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__pennyTest.calls.filter((call) => call.command === "create_transaction").length)).toBe(1);
  await page.evaluate(() => window.__pennyTest.release("create_transaction"));
  await expect(page.getByText("Fictional pending expense", { exact: true })).toBeVisible();
  await navigate(page, "Overview");
  const summary = page.getByRole("region", { name: "2024-02 financial summary" });
  await expect(summary.getByRole("article").filter({ has: page.getByText("Spending", { exact: true }) })).toContainText("£136.34");
  await expect(summary.getByRole("article").filter({ has: page.getByText("Net cash flow", { exact: true }) })).toContainText("-£134.34");
});

test.describe("initial loading and failure", () => {
  test.use({ blockedCommand: "list_finance_data" });
  test("loading stays explicit and a failed initial load has a working retry", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("Loading your encrypted financial data");
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: /financial summary/ })).toHaveCount(0);
    await page.evaluate(() => {
      window.__pennyTest.failNext("list_finance_data", "Initial finance unavailable.");
      window.__pennyTest.release("list_finance_data");
    });
    await expect(page.getByRole("alert")).toContainText("Initial finance unavailable.");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await navigate(page, "Transactions");
    await expect(page.getByText("Fictional Merchant 16", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("workspace status retry", () => {
  test.use({ blockedCommand: "workspace_status" });
  test("Try again recovers a failed workspace check", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.__pennyTest.failNext("workspace_status", "Workspace check unavailable.");
      window.__pennyTest.release("workspace_status");
    });
    await expect(page.getByRole("alert")).toContainText("Workspace check unavailable.");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await navigate(page, "Transactions");
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
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  });

  test("a locked workspace preserves its deep link through unlock", async ({ page }) => {
    await page.goto("/#/budgets");
    await expect(page.getByRole("navigation", { name: "Workspace pages" })).toHaveCount(0);
    await page.getByLabel("Passphrase", { exact: true }).fill("fictional workspace passphrase");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/#\/budgets$/);
  });
});
