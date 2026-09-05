import React, { useEffect, useRef, useState } from "react";
import { Search, X, User, Check } from "lucide-react";

const SEARCH_DEBOUNCE_MS = 250;

/** Secondary identifying info, e.g. "RES-1024 · 34 yrs · San Isidro". */
const residentMeta = (r) =>
  [
    r.id,
    r.age !== undefined && r.age !== null ? `${r.age} yrs` : null,
    r.barangay || null,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Searchable resident-by-name combobox for large rosters.
 *
 * The full resident list is never rendered — results appear only after the
 * user types, are debounced (swap the filter below for an API call when the
 * backend is wired up), and are capped at `limit` entries. Partial first and
 * last names match ("mar" finds "Maria Santos"); every space-separated token
 * must appear in the name.
 *
 * @param {{ id: string, name: string, barangay?: string }[]} props.residents
 * @param {{ id: string, name: string } | null} props.value selected resident
 * @param (resident: object | null) => void props.onChange
 */
export default function ResidentSearchSelect({
  residents = [],
  value,
  onChange,
  placeholder = "Search resident by name...",
  limit = 8,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null); // null = no search performed yet
  const [totalMatches, setTotalMatches] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Debounced name search — runs only once the user types.
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) {
      setSearching(false);
      setResults(null);
      setTotalMatches(0);
      return undefined;
    }
    setSearching(true);
    const t = setTimeout(() => {
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = residents.filter((r) => {
        const name = String(r.name || "").toLowerCase();
        return tokens.every((token) => name.includes(token));
      });
      setResults(matches.slice(0, limit));
      setTotalMatches(matches.length);
      setHighlighted(0);
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open, residents, limit]);

  // Close the dropdown when clicking outside the field.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (resident) => {
    onChange(resident);
    setQuery("");
    setResults(null);
    setTotalMatches(0);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
    setResults(null);
    setTotalMatches(0);
    setHighlighted(0);
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      // Close the dropdown only — let Escape bubble up to close the modal
      // when the dropdown is already closed.
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!results || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      select(results[highlighted]);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      {value ? (
        // Selected state — full name in the field + clear button.
        <div className="flex w-full items-center justify-between gap-2 rounded-btn border border-brand-border bg-brand-bg/60 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-brand-green" />
            <span className="truncate text-sm font-medium text-brand-ink">{value.name}</span>
            <span className="shrink-0 text-xs text-brand-gray">{residentMeta(value)}</span>
          </span>
          <button
            type="button"
            onClick={clear}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:bg-white hover:text-brand-ink"
            aria-label="Clear selected resident"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        // Search state.
        <div className="flex w-full items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2.5 focus-within:border-brand-blue">
          <Search className="h-4 w-4 shrink-0 text-brand-gray" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls="resident-search-listbox"
            aria-activedescendant={results && results[highlighted] ? `resident-option-${highlighted}` : undefined}
            className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70"
          />
          {query && (
            <button
              type="button"
              onClick={clear}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:text-brand-ink"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Results dropdown — only matching residents, capped at `limit`. */}
      {open && !value && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-btn border border-brand-border bg-white shadow-float">
          {searching ? (
            <p className="px-3 py-3 text-sm text-brand-gray">Searching...</p>
          ) : !query.trim() ? (
            <p className="px-3 py-3 text-sm text-brand-gray">Type a name to search residents...</p>
          ) : results && results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-brand-gray">No residents found.</p>
          ) : (
            results && (
              <>
                <ul id="resident-search-listbox" role="listbox" className="max-h-72 overflow-y-auto py-1">
                  {results.map((r, i) => (
                    <li key={r.id} role="option" aria-selected={i === highlighted} id={`resident-option-${i}`}>
                      <button
                        type="button"
                        onClick={() => select(r)}
                        onMouseEnter={() => setHighlighted(i)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                          i === highlighted ? "bg-brand-light" : "hover:bg-brand-bg"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <User className="h-3.5 w-3.5 shrink-0 text-brand-gray" />
                          <span className="truncate text-sm font-medium text-brand-ink">{r.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-brand-gray">{residentMeta(r)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {totalMatches > results.length && (
                  <p className="border-t border-brand-border bg-brand-bg/60 px-3 py-1.5 text-[11px] text-brand-gray">
                    Showing first {results.length} of {totalMatches} matches — keep typing to narrow down.
                  </p>
                )}
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
