import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { budgetTransactionFilter, financeError, formatPence } from "./finance";
import type { TransactionPage } from "./finance";
import Modal from "./Modal";

export default function BudgetTransactions({ month, categoryId, categoryName, periodEnd, refreshKey, onClose }: {
  month: string; categoryId: number; categoryName: string; periodEnd: string | null;
  refreshKey: string; onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: TransactionPage | null; error: string } | null>(null);
  const key = `${month}:${categoryId}:${periodEnd}:${refreshKey}:${page}:${revision}`;
  const data = result?.key === key ? result.data : null;
  const error = result?.key === key ? result.error : "";
  const loading = periodEnd !== null && !data && !error;

  useEffect(() => {
    const filter = budgetTransactionFilter(month, categoryId, periodEnd, page);
    if (!filter) return;
    let active = true;
    void invoke<TransactionPage>("list_transactions", { filter }).then((data) => {
      if (!active) return;
      const lastPage = Math.max(0, Math.ceil(data.total / filter.pageSize) - 1);
      if (page > lastPage) { setPage(lastPage); return; }
      setResult({ key, data, error: "" });
    }).catch((error: unknown) => {
      if (active) setResult({ key, data: null, error: financeError(error) });
    });
    return () => { active = false; };
  }, [month, categoryId, periodEnd, page, key]);

  return <Modal title={`${categoryName} budget transactions`} busy={false} onClose={onClose}>
    <p className="policy-note">{periodEnd ? `${month}-01 through ${periodEnd}.` : `${month}: no elapsed period.`}
      {" "}Current category choices, including manual corrections. Expenses less refunds; income and transfers excluded. Recorded activity only.</p>
    {loading && <p role="status">Loading budget transactions...</p>}
    {error && <div role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry budget transactions</button></div>}
    {(periodEnd === null || data?.total === 0) && <p>No recorded expense or refund transactions in this budget period.</p>}
    {data && data.total > 0 && <>
      <ul className="budget-transactions" aria-label="Budget transactions">
        {data.transactions.map((transaction) => <li key={transaction.id}>
          <div><strong>{transaction.merchant || transaction.description}</strong>
            {transaction.merchant && <p>{transaction.description}</p>}
            <p><time dateTime={transaction.transactionDate}>{transaction.transactionDate}</time> · {transaction.kind === "refund" ? "Refund" : "Expense"}
              {transaction.categorySource === "manual" && " · Manual category"}</p>
          </div>
          <strong className="budget-transaction-amount">{formatPence(transaction.kind === "refund" ? -transaction.amountPence : transaction.amountPence)}</strong>
        </li>)}
      </ul>
      <nav className="budget-transaction-pages" aria-label="Budget transaction pages">
        <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous transactions</button>
        <p role="status">Page {page + 1} of {Math.ceil(data.total / data.pageSize)} · {data.total} records</p>
        <button type="button" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>Next transactions</button>
      </nav>
    </>}
    <div className="modal-actions"><button type="button" onClick={onClose}>Close transactions</button></div>
  </Modal>;
}
