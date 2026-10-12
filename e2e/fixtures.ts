import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { BudgetData, Category, CategoryRule, FinanceData, SavingsGoal, Transaction } from "../src/finance";

type StartStatus = "new" | "locked" | "unlocked";
type Call = { command: string; args: Record<string, unknown> };
declare global {
  interface Window {
    __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
    __pennyTest: {
      calls: Call[];
      failNext: (command: string, message: string, count?: number) => void;
      hold: (command: string) => void;
      release: (command: string) => void;
      policyViolations: string[];
    };
  }
}

export const test = base.extend<{ startStatus: StartStatus; blockedCommand: string | null; largeAggregates: boolean }>({
  startStatus: ["unlocked", { option: true }],
  blockedCommand: [null, { option: true }],
  largeAggregates: [false, { option: true }],
  page: async ({ page, startStatus, blockedCommand, largeAggregates }, runPage) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.clock.install({ time: new Date("2024-02-15T12:00:00Z") });
    const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const csp: unknown = config.app?.security?.csp;
    if (typeof csp !== "string" || !csp) throw new Error("Expected the production Tauri CSP.");
    await page.route("http://127.0.0.1:1422/", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
    });
    // Mirrors Tauri's `freezePrototype`, which runs before any app code in the desktop webview.
    await page.addInitScript(() => { Object.freeze(Object.prototype); });
    await page.addInitScript(({ initialStatus, blockedCommand, largeAggregates }: { initialStatus: StartStatus; blockedCommand: string | null; largeAggregates: boolean }) => {
      let status = initialStatus;
      let workspacePassword = "fictional workspace passphrase";
      let categories: Category[] = [
        { id: 1, name: "Fictional Food", categoryType: "expense", color: "#D3A348" },
        { id: 2, name: "Fictional Salary", categoryType: "income", color: "#4F8B68" },
      ];
      let transactions: Transaction[] = initialStatus === "new" ? [] : Array.from({ length: 16 }, (_, index) => ({
        id: index + 1, accountId: 1, categoryId: index === 3 ? null : index === 1 ? 2 : 1,
        categoryName: null, amountPence: (index + 1) * 100,
        kind: index === 1 ? "income" : index === 2 ? "refund" : index === 3 ? "transfer" : "expense",
        transactionDate: `2024-02-${String(index + 1).padStart(2, "0")}`,
        description: `Fictional record ${index + 1}`, merchant: `Fictional Merchant ${index + 1}`,
        merchantNormalized: `fictional merchant ${index + 1}`,
        categorySource: index === 3 ? "transfer" : "manual", categoryExplanation: "Manual choice preserved.",
      }));
      let rules: CategoryRule[] = [];
      if (largeAggregates) {
        const template = transactions[0];
        transactions = Array.from({ length: 90_073 }, (_, index) => ({
          ...template, id: index + 1, amountPence: index === 90_072 ? 1 : 99_999_999_999,
          description: "Fictional aggregate fixture", merchant: "Fictional aggregate merchant",
        }));
      }
      let goals: SavingsGoal[] = [];
      let budgets: { month: string; categoryId: number; limitPence: number }[] = [];
      let comparisonMode = "same_day";
      let nextTransactionId = transactions.length + 1;
      let nextCategoryId = 3;
      let nextRuleId = 1;
      let nextGoalId = 1;
      const failures = new Map<string, { message: string; count: number }>();
      const holds = new Map<string, { pending: Promise<void>; release: () => void }>();
      const calls: Call[] = [];
      const policyViolations: string[] = [];
      document.addEventListener("securitypolicyviolation", (event) => policyViolations.push(event.violatedDirective));
      window.__pennyTest = {
        calls,
        policyViolations,
        failNext: (command, message, count = 1) => failures.set(command, { message, count }),
        hold: (command) => {
          const pending = new Promise<void>((release) => holds.set(command, { pending: Promise.resolve(), release }));
          const hold = holds.get(command);
          if (!hold) throw new Error("Missing test request hold.");
          hold.pending = pending;
        },
        release: (command) => {
          const hold = holds.get(command);
          if (!hold) throw new Error("No pending test request hold.");
          holds.delete(command);
          hold.release();
        },
      };
      if (blockedCommand) window.__pennyTest.hold(blockedCommand);
      type Snapshot = { categories: Category[]; transactions: Transaction[]; rules: CategoryRule[]; goals: SavingsGoal[]; budgets: typeof budgets; comparisonMode: string };
      let backup: { passphrase: string; snapshot: Snapshot } | null = null;

      function object(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected command object.");
        return value as Record<string, unknown>;
      }
      function integer(input: Record<string, unknown>, key: string, minimum = 0): number {
        const value = input[key];
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${key}.`);
        return value;
      }
      function text(input: Record<string, unknown>, key: string): string {
        const value = input[key];
        if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}.`);
        return value;
      }
      function normalize(value: string): string {
        return value.toLocaleLowerCase("en-GB").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      }
      function classify(row: Transaction) {
        if (row.kind === "transfer") return;
        const matched = rules.filter((rule) => {
          const category = categories.find((item) => item.id === rule.categoryId);
          const compatible = category?.categoryType === (row.kind === "income" ? "income" : "expense");
          const merchant = row.merchantNormalized ?? "";
          return rule.enabled && compatible && (rule.matchType === "exact" ? merchant === rule.pattern : ` ${merchant} `.includes(` ${rule.pattern} `));
        }).sort((left, right) => right.priority - left.priority);
        const top = matched.filter((rule) => rule.priority === matched[0]?.priority);
        const conflict = new Set(top.map((rule) => rule.categoryId)).size > 1;
        row.categoryId = top.length && !conflict ? top[0].categoryId : null;
        row.categorySource = row.categoryId === null ? "uncategorised" : "rule";
        row.categoryExplanation = conflict ? "Conflict: equal priority targets different categories." : row.categoryId === null ? "No matching rule." : "Matched merchant rule.";
      }
      function selected(filter: Record<string, unknown>) {
        return transactions.filter((row) =>
          (!filter.month || row.transactionDate.startsWith(String(filter.month))) &&
          (!filter.from || row.transactionDate >= String(filter.from)) &&
          (!filter.to || row.transactionDate <= String(filter.to)) &&
          (!filter.throughDate || row.transactionDate <= String(filter.throughDate)) &&
          (filter.accountId == null || row.accountId === filter.accountId) &&
          (filter.kind == null || row.kind === filter.kind || (filter.kind === "spending" && (row.kind === "expense" || row.kind === "refund"))) &&
          (filter.categoryId == null || row.categoryId === filter.categoryId) &&
          (!filter.search || `${row.merchant ?? ""} ${row.description}`.toLocaleLowerCase("en-GB").includes(String(filter.search).toLocaleLowerCase("en-GB"))));
      }
      function summary(month: string) {
        const rows = selected({ month });
        const sum = (kind: Transaction["kind"]) => rows.filter((row) => row.kind === kind).reduce((total, row) => total + BigInt(row.amountPence), 0n);
        const incomePence = sum("income"), refundPence = sum("refund"), expensePence = sum("expense") - refundPence;
        return { month, incomePence: String(incomePence), expensePence: String(expensePence), refundPence: String(refundPence), netCashFlowPence: String(incomePence - expensePence) };
      }
      function snapshot(): Snapshot {
        return structuredClone({ categories, transactions, rules, goals, budgets, comparisonMode });
      }
      async function invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
        calls.push({ command, args: structuredClone(args) });
        await holds.get(command)?.pending;
        const failure = failures.get(command);
        if (failure) {
          if (--failure.count === 0) failures.delete(command);
          throw new Error(failure.message);
        }
        if (command === "workspace_status") return status;
        if (command === "lock_workspace") { status = "locked"; return; }
        if (command === "create_workspace_command" || command === "recover_workspace_command" || command === "unlock_workspace_command") {
          const passphrase = text(args, "passphrase");
          if (command === "unlock_workspace_command" && passphrase !== workspacePassword) throw new Error("Incorrect passphrase.");
          if (command !== "unlock_workspace_command") {
            if (passphrase.length < 12) throw new Error("Use at least 12 characters.");
            workspacePassword = passphrase;
          }
          status = "unlocked"; return;
        }
        if (status !== "unlocked") throw new Error("Workspace is locked.");
        switch (command) {
          case "list_finance_data": {
            const month = text(args, "month");
            const spending = new Map<number | null, bigint>();
            for (const row of selected({ month })) {
              if (row.kind === "expense" || row.kind === "refund") spending.set(row.categoryId, (spending.get(row.categoryId) ?? 0n) + BigInt(row.amountPence) * (row.kind === "refund" ? -1n : 1n));
            }
            const [year, number] = month.split("-").map(Number);
            const result: FinanceData = {
              summary: summary(month),
              history: Array.from({ length: 6 }, (_, index) => {
                const date = new Date(year, number - 6 + index, 15);
                return summary(`${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}`);
              }).filter((item) => item.month >= "1000-01"),
              categorySpending: Array.from(spending, ([categoryId, amountPence]) => {
                const category = categories.find((item) => item.id === categoryId);
                return { categoryId, categoryName: category?.name ?? "Uncategorised", color: category?.color ?? "#66746b", amountPence: String(amountPence) };
              }),
              accounts: [{ id: 1, name: "Fictional account", currencyCode: "GBP" }], categories: structuredClone(categories),
            };
            return result;
          }
          case "list_transactions": {
            const filter = object(args.filter);
            const rows = selected(filter).map((row) => ({ ...row, categoryName: categories.find((item) => item.id === row.categoryId)?.name ?? null }));
            rows.sort((left, right) => {
              switch (filter.sort) {
                case "amount_desc": return right.amountPence - left.amountPence || right.id - left.id;
                case "amount_asc": return left.amountPence - right.amountPence || left.id - right.id;
                case "date_asc": return left.transactionDate.localeCompare(right.transactionDate) || left.id - right.id;
                case "merchant_asc": return (left.merchantNormalized ?? "").localeCompare(right.merchantNormalized ?? "") || left.id - right.id;
                default: return right.transactionDate.localeCompare(left.transactionDate) || right.id - left.id;
              }
            });
            const page = integer(filter, "page"), pageSize = integer(filter, "pageSize", 1);
            return { transactions: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length, page, pageSize };
          }
          case "create_transaction": {
            const input = object(args.input);
            const kind = text(input, "kind");
            if (kind !== "income" && kind !== "expense" && kind !== "refund" && kind !== "transfer") throw new Error("Invalid transaction kind.");
            const row: Transaction = {
              id: nextTransactionId++, accountId: integer(input, "accountId", 1),
              categoryId: input.categoryId === null ? null : integer(input, "categoryId", 1), categoryName: null,
              amountPence: integer(input, "amountPence", 1), kind,
              transactionDate: text(input, "transactionDate"), description: text(input, "description"),
              merchant: typeof input.merchant === "string" ? input.merchant : null,
              merchantNormalized: typeof input.merchant === "string" ? normalize(input.merchant) : null,
              categorySource: kind === "transfer" ? "transfer" : input.manualCategory ? "manual" : "uncategorised",
              categoryExplanation: "Manual choice preserved.",
            };
            if (row.categorySource !== "manual") classify(row);
            transactions.push(row); return row.id;
          }
          case "update_transaction_category":
          case "reset_transaction_category":
          case "delete_transaction": {
            const id = integer(args, "transactionId", 1), row = transactions.find((item) => item.id === id);
            if (!row) throw new Error("Transaction not found.");
            if (command === "delete_transaction") transactions = transactions.filter((item) => item.id !== id);
            else if (command === "reset_transaction_category") classify(row);
            else { row.categoryId = args.categoryId === null ? null : integer(args, "categoryId", 1); row.categorySource = "manual"; row.categoryExplanation = "Manual choice preserved."; }
            return;
          }
          case "list_budgets": {
            const month = text(args, "month"), asOf = text(args, "asOf"), end = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0);
            const monthEnd = `${month}-${String(end.getDate()).padStart(2, "0")}`;
            const periodEnd = month > asOf.slice(0, 7) ? null : month === asOf.slice(0, 7) ? asOf : monthEnd;
            const result: BudgetData = {
              month, asOf, periodEnd, previousMonth: month === "1000-01" ? null : "2024-01", previousEnd: null, comparisonMode,
              rows: budgets.filter((row) => row.month === month).map((row) => {
                const recorded = periodEnd ? selected({ from: `${month}-01`, to: periodEnd, categoryId: row.categoryId }).filter((item) => item.kind === "expense" || item.kind === "refund") : [];
                return { ...row, categoryName: categories.find((item) => item.id === row.categoryId)?.name ?? "Uncategorised",
                  usedPence: String(recorded.reduce((total, item) => total + BigInt(item.amountPence) * (item.kind === "refund" ? -1n : 1n), 0n)),
                  previousUsedPence: null, recordCount: recorded.length, previousRecordCount: 0 };
              }),
            };
            return result;
          }
          case "save_budget": {
            const input = object(args.input), month = text(input, "month"), categoryId = integer(input, "categoryId", 1), limitPence = integer(input, "limitPence", 1);
            if (!categories.some((item) => item.id === categoryId && item.categoryType === "expense")) throw new Error("Choose an expense category.");
            budgets = budgets.filter((row) => row.month !== month || row.categoryId !== categoryId);
            budgets.push({ month, categoryId, limitPence }); return;
          }
          case "delete_budget": budgets = budgets.filter((row) => row.month !== args.month || row.categoryId !== args.categoryId); return;
          case "save_budget_preferences": comparisonMode = text(args, "comparisonMode"); return;
          case "list_savings_goals": return structuredClone(goals);
          case "save_savings_goal": {
            const input = object(args.input), id = input.id === null ? nextGoalId++ : integer(input, "id", 1);
            const goal: SavingsGoal = { id, name: text(input, "name"), targetPence: integer(input, "targetPence", 1), progressPence: integer(input, "progressPence"),
              targetDate: typeof input.targetDate === "string" ? input.targetDate : null, notes: typeof input.notes === "string" ? input.notes : "" };
            goals = goals.filter((item) => item.id !== id); goals.push(goal); return id;
          }
          case "delete_savings_goal": goals = goals.filter((row) => row.id !== args.goalId); return;
          case "list_category_rules": return structuredClone(rules);
          case "save_category": {
            const input = object(args.input), id = input.id === null ? nextCategoryId++ : integer(input, "id", 1), categoryType = text(input, "categoryType");
            if (categoryType !== "expense" && categoryType !== "income") throw new Error("Invalid category type.");
            const category: Category = { id, name: text(input, "name"), categoryType, color: text(input, "color") };
            categories = categories.filter((item) => item.id !== id); categories.push(category); return id;
          }
          case "delete_category": {
            const id = integer(args, "categoryId", 1);
            if (transactions.some((row) => row.categoryId === id) || rules.some((row) => row.categoryId === id) || budgets.some((row) => row.categoryId === id)) throw new Error("Category is in use.");
            categories = categories.filter((item) => item.id !== id); return;
          }
          case "save_category_rule": {
            const input = object(args.input), id = input.id === null ? nextRuleId++ : integer(input, "id", 1), matchType = text(input, "matchType"), priority = integer(input, "priority");
            if (priority > 1000 || (matchType !== "exact" && matchType !== "contains") || typeof input.enabled !== "boolean") throw new Error("Invalid rule.");
            const rule: CategoryRule = { id, pattern: normalize(text(input, "pattern")), matchType, categoryId: integer(input, "categoryId", 1), priority, enabled: input.enabled };
            rules = rules.filter((item) => item.id !== id); rules.push(rule); return id;
          }
          case "delete_category_rule": rules = rules.filter((row) => row.id !== args.ruleId); return;
          case "reclassify_transactions": {
            const automatic = transactions.filter((row) => row.categorySource !== "manual" && row.kind !== "transfer");
            automatic.forEach(classify); return automatic.length;
          }
          case "private_data_locations": return ["/fictional/private-exports", "/fictional/private-backups"];
          case "export_private_transactions": {
            if (args.confirmed !== true) throw new Error("Plaintext consent required.");
            const scope = object(args.scope);
            if (String(scope.from) > String(scope.to)) throw new Error("Export start must precede end.");
            return { path: "/fictional/private-exports/test.csv", recordCount: selected(scope).length };
          }
          case "create_private_backup": {
            const passphrase = text(args, "passphrase");
            if (passphrase.length < 12) throw new Error("Use at least 12 characters.");
            backup = { passphrase, snapshot: snapshot() };
            return { path: "/fictional/private-backups/test.ppbackup", recordCount: transactions.length };
          }
          case "restore_private_backup": {
            if (args.confirmation !== "RESTORE" || args.path !== "/fictional/private-backups/test.ppbackup" || !backup || args.passphrase !== backup.passphrase) throw new Error("Invalid backup. Existing data was not replaced.");
            ({ categories, transactions, rules, goals, budgets, comparisonMode } = structuredClone(backup.snapshot));
            return { safetyBackupPath: "/fictional/private-backups/safety.ppbackup", recordCount: transactions.length };
          }
          default: throw new Error(`Unimplemented test IPC command: ${command}`);
        }
      }
      Object.defineProperty(window, "isTauri", { value: true, configurable: true });
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke }, configurable: true });
    }, { initialStatus: startStatus, blockedCommand, largeAggregates });
    await runPage(page);
    expect(await page.evaluate(() => Object.isFrozen(Object.prototype)), "App runs with a frozen Object.prototype").toBe(true);
    expect(await page.evaluate(() => window.__pennyTest.policyViolations), "Normal flows comply with the production CSP").toEqual([]);
    expect(consoleErrors, "Normal app flows must not emit console errors").toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal page overflow").toBe(true);
    const undersized = await page.getByRole("button").evaluateAll((buttons) => buttons
      .filter((button) => !button.hasAttribute("disabled") && button.getBoundingClientRect().height > 0 && button.getBoundingClientRect().height < 44)
      .map((button) => button.textContent?.trim()));
    expect(undersized, "Visible enabled buttons need at least 44px touch targets").toEqual([]);
    const missingPointers = await page.getByRole("button").evaluateAll((buttons) => buttons
      .filter((button) => button.matches(":enabled") && button.getBoundingClientRect().height > 0 && getComputedStyle(button).cursor !== "pointer")
      .map((button) => button.textContent?.trim()));
    expect(missingPointers, "Visible enabled buttons use a pointer cursor").toEqual([]);
  },
});

export { expect };
