import { useEffect, useState } from "react";

export const workspacePages = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "budgets", label: "Budgets" },
  { id: "savings", label: "Savings" },
  { id: "categories", label: "Categories & Rules" },
  { id: "backup", label: "Export & Backup" },
] as const;

export type WorkspacePage = typeof workspacePages[number]["id"];

function readPage(): WorkspacePage {
  const id = window.location.hash.slice(2);
  const page = workspacePages.find((item) => item.id === id)?.id;
  if (page) return page;
  // Canonicalise missing/unsupported routes without adding a history entry.
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/overview`);
  return "overview";
}

export function useWorkspacePage(): WorkspacePage {
  const [page, setPage] = useState(readPage);
  useEffect(() => {
    const changed = () => setPage(readPage());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return page;
}
