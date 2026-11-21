import { ChevronDown, Search, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface AutocompleteOption {
  value: string;
  subtitle?: string;
}

interface AutocompleteInputProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  options: AutocompleteOption[];
  onChange: (exactValue: string) => void;
  emptyMessage: string;
  required?: boolean;
  disabled?: boolean;
}

function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function AutocompleteInput({
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
  emptyMessage,
  required,
  disabled,
}: AutocompleteInputProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Revert display text to last confirmed official selection if user didn't pick one
        setQuery(value);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [value]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return options.slice(0, 40);
    const words = q.split(/\s+/).filter(Boolean);
    const startsWithMatches: AutocompleteOption[] = [];
    const wordMatches: AutocompleteOption[] = [];

    for (const opt of options) {
      const hay = normalizeSearch(`${opt.value} ${opt.subtitle || ''}`);
      const valNorm = normalizeSearch(opt.value);
      const matchesAll = words.every((w) => hay.includes(w));
      if (!matchesAll) continue;
      if (valNorm.startsWith(q)) {
        startsWithMatches.push(opt);
      } else {
        wordMatches.push(opt);
      }
    }
    return [...startsWithMatches, ...wordMatches].slice(0, 40);
  }, [options, query]);

  const handleSelect = (exactVal: string) => {
    setQuery(exactVal);
    onChange(exactVal);
    setOpen(false);
  };

  const handleClear = () => {
    setQuery('');
    onChange('');
    setOpen(true);
  };

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
      >
        {label} {required && <span className="text-[#C8102E]">*</span>}
      </label>

      <div className="relative">
        <Search
          className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setOpen(true);
            if (next === '') {
              onChange('');
            }
          }}
          className="w-full min-h-[44px] pl-10 pr-16 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E] transition-colors disabled:opacity-60"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {(query || value) && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              aria-label={`Limpiar ${label}`}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            aria-label={`Mostrar opciones de ${label}`}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {value && query === value && (
        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
          Selección oficial confirmada
        </p>
      )}
      {!value && query.trim().length > 0 && !open && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          Selecciona una opción oficial de la lista desplegable.
        </p>
      )}

      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-40 mt-1.5 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg divide-y divide-slate-100 dark:divide-slate-800"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
              {emptyMessage}
            </div>
          ) : (
            filtered.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(opt.value);
                  }}
                  onClick={() => handleSelect(opt.value)}
                  className={`w-full text-left px-4 py-2.5 min-h-[44px] flex flex-col justify-center transition-colors ${
                    isSelected
                      ? 'bg-[#C8102E]/10 text-[#C8102E] dark:text-red-400 font-medium'
                      : 'text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <span className="text-sm">{opt.value}</span>
                  {opt.subtitle && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {opt.subtitle}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
