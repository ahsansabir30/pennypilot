import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { financeError, formatPence, localIsoDate } from "./finance";
import type { BudgetData, SavingsGoal } from "./finance";

export default function FinancialHighlights({ month, refreshKey, onBudgets, onGoals }: {
  month: string; refreshKey: number; onBudgets: () => void; onGoals: () => void;
}) {
  const [budgetState, setBudgetState] = useState<{ key: string; data: BudgetData | null; error: string } | null>(null);
  const [goalState, setGoalState] = useState<{ key: string; data: SavingsGoal[] | null; error: string } | null>(null);
  const [budgetRetry, setBudgetRetry] = useState(0);
  const [goalRetry, setGoalRetry] = useState(0);
  const budgetKey = `${month}:${refreshKey}:${budgetRetry}`;
  const goalKey = `${refreshKey}:${goalRetry}`;

  useEffect(() => {
    let active = true;
    invoke<BudgetData>("list_budgets", { month, asOf: localIsoDate() })
      .then((data) => { if (active) setBudgetState({ key: budgetKey, data, error: "" }); })
      .catch((error: unknown) => { if (active) setBudgetState({ key: budgetKey, data: null, error: financeError(error) }); });
    return () => { active = false; };
  }, [month, budgetKey]);

  useEffect(() => {
    let active = true;
    invoke<SavingsGoal[]>("list_savings_goals")
      .then((data) => { if (active) setGoalState({ key: goalKey, data, error: "" }); })
      .catch((error: unknown) => { if (active) setGoalState({ key: goalKey, data: null, error: financeError(error) }); });
    return () => { active = false; };
  }, [goalKey]);

  const current = budgetState?.key === budgetKey && budgetState.data?.month === month ? budgetState.data : null;
  const budgetError = budgetState?.key === budgetKey ? budgetState.error : "";
  const goalError = goalState?.key === goalKey ? goalState.error : "";
  const goals = goalState?.key === goalKey ? goalState.data : null;
  const previewBudgets = current?.rows.slice().sort((left, right) =>
    right.usedPence / right.limitPence - left.usedPence / left.limitPence || left.categoryId - right.categoryId).slice(0, 3) ?? [];
  const overLimitCount = current?.rows.filter((row) => row.usedPence > row.limitPence).length ?? 0;
  return <section className="planning-grid" aria-label="Budget and savings overview">
    <article className="panel planning-panel" aria-labelledby="budget-preview-title">
      <div className="panel-heading">
        <h2 id="budget-preview-title">Budget check-in</h2>
        <button className="text-button" type="button" onClick={onBudgets}>Manage budgets</button>
      </div>
      {budgetError ? <div className="preview-error" role="alert">{budgetError}
        <button type="button" className="text-button" onClick={() => setBudgetRetry((value) => value + 1)}>Retry budget overview</button>
      </div> : !current ? <p role="status" className="preview-empty">Loading your budget plan...</p>
        : current.rows.length === 0 ? <div className="preview-empty">
          <strong>No budgets this month.</strong>
          <button className="lock-button" type="button" onClick={onBudgets}>Set your first budget</button>
        </div> : <>
          <p className="preview-caption">{current.rows.length} budgeted {current.rows.length === 1 ? "category" : "categories"} · {overLimitCount} over limit · {current.periodEnd ? `Recorded through ${current.periodEnd}` : "Future month; no elapsed spending period"}</p>
          <ul className="preview-list">
            {previewBudgets.map((row) => {
              const over = row.usedPence > row.limitPence;
              const percent = Math.max(0, row.usedPence) / row.limitPence * 100;
              return <li key={row.categoryId}>
                <div className="preview-row"><strong>{row.categoryName}</strong><span className={`plan-status ${over ? "over" : ""}`}>
                  {over ? "Over limit" : row.recordCount === 0 ? "No records yet" : percent >= 80 ? "Near limit" : "Within limit"}</span></div>
                <div className="preview-row preview-amount"><span>{formatPence(row.usedPence)} of {formatPence(row.limitPence)}</span>
                  <strong>{formatPence(Math.abs(row.limitPence - row.usedPence))} {over ? "over" : "left"}</strong></div>
                <progress aria-label={`${row.categoryName} allowance used`} max={100} value={Math.min(100, percent)} className={over ? "over" : ""} />
              </li>;
            })}
          </ul>
          {current.rows.length > 3 && <p className="preview-caption">Showing 3 of {current.rows.length} categories, highest usage first. Manage budgets to see all.</p>}
          <p className="policy-note">Expenses less refunds. Transfers excluded; history may be incomplete.</p>
        </>}
    </article>
    <article className="panel planning-panel" aria-labelledby="goal-preview-title">
      <div className="panel-heading">
        <h2 id="goal-preview-title">Savings at a glance</h2>
        <button className="text-button" type="button" onClick={onGoals}>Manage goals</button>
      </div>
      {goalError ? <div className="preview-error" role="alert">{goalError}
        <button className="text-button" type="button" onClick={() => setGoalRetry((value) => value + 1)}>Retry savings overview</button>
      </div> : goals === null ? <p role="status" className="preview-empty">Loading your savings goals...</p>
        : goals.length === 0 ? <div className="preview-empty">
          <strong>No savings goals yet.</strong>
          <button className="lock-button" type="button" onClick={onGoals}>Create your first goal</button>
        </div> : <>
          <p className="preview-caption">Entered progress · Not a bank balance</p>
          <ul className="preview-list">
            {goals.slice(0, 3).map((goal) => <li key={goal.id}>
              <div className="preview-row"><strong>{goal.name}</strong><span className="plan-status">
                {goal.progressPence >= goal.targetPence ? "Target reached" : `${Math.floor(goal.progressPence / goal.targetPence * 1000) / 10}% saved`}</span></div>
              <div className="preview-row preview-amount"><span>{formatPence(goal.progressPence)} of {formatPence(goal.targetPence)}</span>
                <strong>{formatPence(Math.max(0, goal.targetPence - goal.progressPence))} to go</strong></div>
              <progress aria-label={`${goal.name} entered savings progress`} max={100} value={Math.min(100, goal.progressPence / goal.targetPence * 100)} />
            </li>)}
          </ul>
          {goals.length > 3 && <p className="preview-caption">Showing 3 of {goals.length} goals. Manage goals to see all.</p>}
        </>}
    </article>
  </section>;
}
