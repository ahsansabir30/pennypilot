import { useTheme } from "./theme";

export default function ThemeToggle() {
  const { theme, toggleTheme, storageError } = useTheme();
  const dark = theme === "dark";

  return (
    <>
    <button aria-checked={dark} aria-label="Dark mode" className="theme-toggle" onClick={toggleTheme}
      role="switch" title={dark ? "Switch to light mode" : "Switch to dark mode"} type="button">
      <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round"
        strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="20">
        {dark
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
          : <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />}
      </svg>
    </button>
    {storageError && <span className="theme-storage-error" role="status">{storageError}</span>}
    </>
  );
}
