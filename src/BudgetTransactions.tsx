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
  const firstRecord = data ? page * data.pageSize + 1 : 0;
  const lastRecord = data ? Math.min((page + 1) * data.pageSize, data.total) : 0;

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
    {loading && <p role="status">Loading budget transactions...</p>}
    {error && <div role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry budget transactions</button></div>}
    {(periodEnd === null || data?.total === 0) && <p>{periodEnd === null ? "No spending yet this month." : "No transactions in this budget period."}</p>}
    {data && data.total > 0 && <>
      <ul className="budget-transactions" aria-label="Budget transactions">
        {data.transactions.map((transaction) => <li key={transaction.id}>
          <div><strong>{transaction.merchant || transaction.description}</strong>
            {transaction.merchant && <p>{transaction.description}</p>}
            <p><time dateTime={transaction.transactionDate}>{transaction.transactionDate}</time> · {transaction.kind === "refund" ? "Refund" : "Expense"}</p>
          </div>
          <strong className="budget-transaction-amount">{formatPence(transaction.kind === "refund" ? -transaction.amountPence : transaction.amountPence)}</strong>
        </li>)}
      </ul>
      <nav className="budget-transaction-pages" aria-label="Budget transaction pages">
        <button type="button" aria-label="Previous transactions" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
        </button>
        <p role="status">{data.total <= data.pageSize ? `${data.total} ${data.total === 1 ? "transaction" : "transactions"}`
          : `${firstRecord === lastRecord ? firstRecord : `${firstRecord}–${lastRecord}`} of ${data.total} transactions`}</p>
        <button type="button" aria-label="Next transactions" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
        </button>
      </nav>
    </>}
    <div className="modal-actions"><button type="button" aria-label="Close transactions" onClick={onClose}>Close</button></div>
  </Modal>;
}
