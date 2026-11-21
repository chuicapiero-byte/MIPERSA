import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  Lock,
  Plus,
  Unlock,
  X,
  XCircle,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import type { Bloqueo, Perfil, Solicitud } from '../types.ts';
import { EstadoTexto } from './BrandMark.tsx';

interface CalendarioViewProps {
  mode?: 'panel' | 'mi-agenda';
  solicitudes: Solicitud[];
  bloqueos: Bloqueo[];
  tecnicos: Perfil[];
  currentProfile: Perfil;
  margenMinutos: number;
  onNavigateSolicitud: (codigo: string) => void;
  onOpenNueva?: (prefill?: { fecha?: string; tecnicoId?: string }) => void;
  onRefresh: () => Promise<void>;
}

const WEEKDAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const WEEKDAYS_SHORT_UPPER = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const MONTHS_SHORT_ES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];
const MONTHS_SHORT_UPPER = [
  'ENE',
  'FEB',
  'MAR',
  'ABR',
  'MAY',
  'JUN',
  'JUL',
  'AGO',
  'SEP',
  'OCT',
  'NOV',
  'DIC',
];

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toISODate(y: number, mZero: number, d: number): string {
  return `${y}-${String(mZero + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getMondayOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatWeekRangeLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const d1 = monday.getDate();
  const m1 = MONTHS_SHORT_ES[monday.getMonth()];
  const y1 = monday.getFullYear();
  const d2 = sunday.getDate();
  const m2 = MONTHS_SHORT_ES[sunday.getMonth()];
  const y2 = sunday.getFullYear();
  if (y1 === y2) {
    return `${d1} ${m1} – ${d2} ${m2} ${y2}`;
  }
  return `${d1} ${m1} ${y1} – ${d2} ${m2} ${y2}`;
}

export function CalendarioView({
  mode = 'panel',
  solicitudes,
  bloqueos,
  tecnicos,
  currentProfile,
  margenMinutos,
  onNavigateSolicitud,
  onOpenNueva,
  onRefresh,
}: CalendarioViewProps) {
  const now = new Date();
  const todayISO = dateToISO(now);

  // Month state (used in Mi Agenda and optional Month view)
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0..11

  // Week state (used in Panel weekly matrix matching MIPERSA design)
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(now));

  const isTecnico = currentProfile.rol === 'tecnico';
  const canBlock = currentProfile.rol === 'tecnico' || currentProfile.rol === 'admin';
  const canCreate = currentProfile.rol === 'vendedor' || currentProfile.rol === 'admin';

  // Panel mode: "Todos los asesores" vs "Por asesor" (for tecnico, strictly self)
  const [panelScope, setPanelScope] = useState<'todos' | 'asesor'>(
    isTecnico ? 'asesor' : 'todos'
  );
  const [granularity, setGranularity] = useState<'semana' | 'mes'>('semana');
  const [selectedTecnicoId, setSelectedTecnicoId] = useState(
    isTecnico ? currentProfile.id : tecnicos[0]?.id || ''
  );
  const [showRejected, setShowRejected] = useState(false);

  const [selectedVisit, setSelectedVisit] = useState<Solicitud | null>(null);
  const [selectedBloqueo, setSelectedBloqueo] = useState<Bloqueo | null>(null);

  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockFecha, setBlockFecha] = useState(todayISO);
  const [blockTecnicoId, setBlockTecnicoId] = useState(
    isTecnico ? currentProfile.id : tecnicos[0]?.id || ''
  );
  const [blockMotivo, setBlockMotivo] = useState('');
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState('');

  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState('');

  // Ensure selectedTecnicoId stays valid when tecnicos load
  const activeSelectedTecnicoId = useMemo(() => {
    if (isTecnico) return currentProfile.id;
    if (selectedTecnicoId && tecnicos.some((t) => t.id === selectedTecnicoId)) {
      return selectedTecnicoId;
    }
    return tecnicos[0]?.id || '';
  }, [isTecnico, currentProfile.id, selectedTecnicoId, tecnicos]);

  // Rows to display in the weekly matrix
  const matrixTecnicos = useMemo(() => {
    if (isTecnico) return [currentProfile];
    if (panelScope === 'asesor') {
      const found = tecnicos.find((t) => t.id === activeSelectedTecnicoId);
      return found ? [found] : tecnicos.slice(0, 1);
    }
    return tecnicos;
  }, [isTecnico, currentProfile, panelScope, tecnicos, activeSelectedTecnicoId]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      return {
        date: d,
        dateISO: dateToISO(d),
        dayShort: WEEKDAYS_SHORT_UPPER[i],
        dayNum: d.getDate(),
        monthShort: MONTHS_SHORT_UPPER[d.getMonth()],
      };
    });
  }, [weekStart]);

  const filteredSolicitudes = useMemo(() => {
    return solicitudes.filter((s) => {
      if (!showRejected && s.estado === 'RECHAZADA') return false;
      if (isTecnico) return s.tecnico_id === currentProfile.id;
      if (mode === 'mi-agenda' && selectedTecnicoId && s.tecnico_id !== selectedTecnicoId) {
        return false;
      }
      if (mode === 'panel' && panelScope === 'asesor' && activeSelectedTecnicoId) {
        return s.tecnico_id === activeSelectedTecnicoId;
      }
      return true;
    });
  }, [
    solicitudes,
    showRejected,
    isTecnico,
    currentProfile.id,
    mode,
    selectedTecnicoId,
    panelScope,
    activeSelectedTecnicoId,
  ]);

  const filteredBloqueos = useMemo(() => {
    return bloqueos.filter((b) => {
      if (isTecnico) return b.tecnico_id === currentProfile.id;
      if (mode === 'mi-agenda' && selectedTecnicoId && b.tecnico_id !== selectedTecnicoId) {
        return false;
      }
      if (mode === 'panel' && panelScope === 'asesor' && activeSelectedTecnicoId) {
        return b.tecnico_id === activeSelectedTecnicoId;
      }
      return true;
    });
  }, [bloqueos, isTecnico, currentProfile.id, mode, selectedTecnicoId, panelScope, activeSelectedTecnicoId]);

  // Index visits & blocks by `${tecnico_id}__${fecha}` for fast matrix lookup
  const matrixCellMap = useMemo(() => {
    const map = new Map<string, { visits: Solicitud[]; block: Bloqueo | null }>();
    for (const s of solicitudes) {
      if (!showRejected && s.estado === 'RECHAZADA') continue;
      if (isTecnico && s.tecnico_id !== currentProfile.id) continue;
      const key = `${s.tecnico_id}__${s.fecha}`;
      const existing = map.get(key) || { visits: [], block: null };
      existing.visits.push(s);
      map.set(key, existing);
    }
    for (const key of map.keys()) {
      map.get(key)!.visits.sort((a, b) => a.hora_salida.localeCompare(b.hora_salida));
    }
    for (const b of bloqueos) {
      if (isTecnico && b.tecnico_id !== currentProfile.id) continue;
      const key = `${b.tecnico_id}__${b.fecha}`;
      const existing = map.get(key) || { visits: [], block: null };
      existing.block = b;
      map.set(key, existing);
    }
    return map;
  }, [solicitudes, bloqueos, showRejected, isTecnico, currentProfile.id]);

  // Monthly grid cells (used in Mi Agenda and when Month granularity is picked)
  const calendarCells = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{ dateISO: string | null; dayNum: number | null }> = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ dateISO: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ dateISO: toISODate(year, month, d), dayNum: d });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateISO: null, dayNum: null });
    }
    return cells;
  }, [year, month]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, { visits: Solicitud[]; blocks: Bloqueo[] }>();
    for (const v of filteredSolicitudes) {
      const entry = map.get(v.fecha) || { visits: [], blocks: [] };
      entry.visits.push(v);
      map.set(v.fecha, entry);
    }
    for (const b of filteredBloqueos) {
      const entry = map.get(b.fecha) || { visits: [], blocks: [] };
      entry.blocks.push(b);
      map.set(b.fecha, entry);
    }
    return map;
  }, [filteredSolicitudes, filteredBloqueos]);

  const monthAgendaDates = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const keys = Array.from(eventsByDate.keys())
      .filter((k) => k.startsWith(prefix))
      .sort();
    return keys.map((k) => ({ dateISO: k, ...eventsByDate.get(k)! }));
  }, [eventsByDate, year, month]);

  const goPrevWeek = () => setWeekStart((w) => addDays(w, -7));
  const goNextWeek = () => setWeekStart((w) => addDays(w, 7));
  const goTodayWeek = () => setWeekStart(getMondayOfWeek(new Date()));

  const goPrevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const handleCreateBloqueo = async (e: React.FormEvent) => {
    e.preventDefault();
    setBlockError('');
    setBlockSubmitting(true);
    try {
      await apiRequest('/api/bloqueos', {
        method: 'POST',
        body: JSON.stringify({
          tecnico_id: isTecnico ? currentProfile.id : blockTecnicoId,
          fecha: blockFecha,
          motivo: blockMotivo.trim(),
        }),
      });
      setBlockMotivo('');
      setBlockModalOpen(false);
      await onRefresh();
    } catch (err) {
      setBlockError(err instanceof ApiError ? err.message : 'No se pudo registrar el bloqueo.');
    } finally {
      setBlockSubmitting(false);
    }
  };

  const handleReleaseBloqueo = async (id: string) => {
    setReleasingId(id);
    setReleaseError('');
    try {
      await apiRequest(`/api/bloqueos/${id}`, { method: 'DELETE' });
      setSelectedBloqueo(null);
      await onRefresh();
    } catch (err) {
      setReleaseError(err instanceof ApiError ? err.message : 'No se pudo liberar el bloqueo.');
    } finally {
      setReleasingId(null);
    }
  };

  const kpiStats = useMemo(() => {
    const scopeSols = isTecnico
      ? solicitudes.filter((s) => s.tecnico_id === currentProfile.id)
      : selectedTecnicoId && mode === 'mi-agenda'
        ? solicitudes.filter((s) => s.tecnico_id === selectedTecnicoId)
        : solicitudes;
    return {
      pendientes: scopeSols.filter((s) => s.estado === 'PENDIENTE').length,
      aceptadas: scopeSols.filter((s) => s.estado === 'ACEPTADA').length,
      bloqueosCount: filteredBloqueos.length,
    };
  }, [solicitudes, filteredBloqueos.length, isTecnico, currentProfile.id, selectedTecnicoId, mode]);

  const upcomingVisits = useMemo(() => {
    return filteredSolicitudes
      .filter((s) => s.estado !== 'RECHAZADA' && s.fecha >= todayISO)
      .sort((a, b) => `${a.fecha} ${a.hora_salida}`.localeCompare(`${b.fecha} ${b.hora_salida}`))
      .slice(0, 10);
  }, [filteredSolicitudes, todayISO]);

  // =========================================================================
  // RENDER MODE 1: PANEL (Calendario de visitas — matches MIPERSA mockup)
  // =========================================================================
  if (mode === 'panel') {
    const isWeeklyView = panelScope === 'todos' || granularity === 'semana';

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 dark:text-slate-400 uppercase">
              DISPONIBILIDAD
            </p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-[#061A3E] dark:text-white mt-0.5">
              Calendario de visitas
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canBlock && (
              <button
                type="button"
                onClick={() => {
                  setBlockError('');
                  setBlockTecnicoId(
                    isTecnico ? currentProfile.id : activeSelectedTecnicoId || tecnicos[0]?.id || ''
                  );
                  setBlockModalOpen(true);
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#061A3E] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <Lock className="w-4 h-4" />
                <span>Bloquear día</span>
              </button>
            )}

            {canCreate && onOpenNueva && (
              <button
                type="button"
                onClick={() => onOpenNueva()}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#E10600] hover:bg-[#BE0500] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Nueva solicitud</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Calendar Surface */}
        <div className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5">
          {/* Scope Toggle + Semantic Legend */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {!isTecnico ? (
                <div className="inline-flex items-center p-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950">
                  <button
                    type="button"
                    onClick={() => {
                      setPanelScope('todos');
                      setGranularity('semana');
                    }}
                    className={`min-h-[36px] px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                      panelScope === 'todos'
                        ? 'bg-[#E10600] text-white shadow-xs'
                        : 'text-[#061A3E] dark:text-slate-300 hover:text-[#E10600]'
                    }`}
                  >
                    Todos los asesores
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelScope('asesor')}
                    className={`min-h-[36px] px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                      panelScope === 'asesor'
                        ? 'bg-[#E10600] text-white shadow-xs'
                        : 'text-[#061A3E] dark:text-slate-300 hover:text-[#E10600]'
                    }`}
                  >
                    Por asesor
                  </button>
                </div>
              ) : (
                <span className="text-sm font-medium text-[#061A3E] dark:text-slate-200">
                  Agenda personal de {currentProfile.nombre}
                </span>
              )}

              {(panelScope === 'asesor' || isTecnico) && (
                <div className="flex flex-wrap items-center gap-2">
                  {!isTecnico &&
                    (tecnicos.length <= 6 ? (
                      <div
                        role="tablist"
                        aria-label="Seleccionar asesor técnico"
                        className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      >
                        {tecnicos.map((t) => {
                          const active = t.id === activeSelectedTecnicoId;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              onClick={() => setSelectedTecnicoId(t.id)}
                              className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                                active
                                  ? 'bg-[#061A3E] text-white dark:bg-white dark:text-[#061A3E] shadow-xs'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-[#061A3E] dark:hover:text-white'
                              }`}
                            >
                              {t.nombre}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <select
                        aria-label="Seleccionar asesor técnico"
                        value={activeSelectedTecnicoId}
                        onChange={(e) => setSelectedTecnicoId(e.target.value)}
                        className="min-h-[40px] px-3 py-1.5 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      >
                        {tecnicos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nombre}
                          </option>
                        ))}
                      </select>
                    ))}

                  <div className="inline-flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950">
                    <button
                      type="button"
                      onClick={() => setGranularity('semana')}
                      className={`min-h-[34px] px-3 rounded-md text-xs font-medium ${
                        granularity === 'semana'
                          ? 'bg-white dark:bg-slate-800 text-[#061A3E] dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Semana
                    </button>
                    <button
                      type="button"
                      onClick={() => setGranularity('mes')}
                      className={`min-h-[34px] px-3 rounded-md text-xs font-medium ${
                        granularity === 'mes'
                          ? 'bg-white dark:bg-slate-800 text-[#061A3E] dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Mes
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Semantic Legend (Icon/Swatch + Text) */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-xs border border-emerald-500 bg-emerald-100 dark:bg-emerald-950"
                  aria-hidden="true"
                />
                Libre
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-xs border border-amber-400 bg-amber-100 dark:bg-amber-950"
                  aria-hidden="true"
                />
                En disputa (Pendiente)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-xs border border-red-400 bg-red-100 dark:bg-red-950"
                  aria-hidden="true"
                />
                Ocupado (±{margenMinutos}m)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-xs border border-slate-400 bg-slate-200 dark:bg-slate-700"
                  aria-hidden="true"
                />
                Bloqueado
              </span>
            </div>
          </div>

          {/* Date Range Title + Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-[#061A3E] dark:text-white tabular-nums">
              {isWeeklyView ? formatWeekRangeLabel(weekStart) : `${MONTHS_ES[month]} ${year}`}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <label className="min-h-[40px] flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer mr-2">
                <input
                  type="checkbox"
                  checked={showRejected}
                  onChange={(e) => setShowRejected(e.target.checked)}
                  className="w-4 h-4 accent-[#E10600]"
                />
                <span>Mostrar rechazadas</span>
              </label>

              <button
                type="button"
                onClick={isWeeklyView ? goPrevWeek : goPrevMonth}
                aria-label={isWeeklyView ? 'Semana anterior' : 'Mes anterior'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isWeeklyView) {
                    goTodayWeek();
                  } else {
                    setYear(now.getFullYear());
                    setMonth(now.getMonth());
                  }
                }}
                className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#061A3E] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={isWeeklyView ? goNextWeek : goNextMonth}
                aria-label={isWeeklyView ? 'Semana siguiente' : 'Mes siguiente'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* WEEKLY MATRIX VIEW (Desktop / Tablet md:+) */}
          {isWeeklyView ? (
            <>
              <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse table-fixed">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="w-48 p-3 text-left text-[11px] font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-950 sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800">
                        Asesor técnico
                      </th>
                      {weekDays.map((wd) => {
                        const isToday = wd.dateISO === todayISO;
                        return (
                          <th
                            key={wd.dateISO}
                            className={`p-3 text-left border-r last:border-r-0 border-slate-200 dark:border-slate-800 ${
                              isToday
                                ? 'bg-red-50/90 dark:bg-red-950/40 text-[#C8102E] dark:text-red-400'
                                : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            <div className="text-[11px] font-semibold tracking-wider uppercase">
                              {wd.dayShort}
                            </div>
                            <div className="text-xs font-mono font-bold tabular-nums mt-0.5">
                              {wd.dayNum} {wd.monthShort}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {matrixTecnicos.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-sm text-slate-500">
                          No hay asesores técnicos activos registrados.
                        </td>
                      </tr>
                    ) : (
                      matrixTecnicos.map((tec) => (
                        <tr key={tec.id} className="align-top">
                          <td className="p-3 bg-white dark:bg-slate-900 sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800">
                            <p className="text-sm font-semibold text-[#061A3E] dark:text-white leading-snug">
                              {tec.nombre}
                            </p>
                            {!isTecnico && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedTecnicoId(tec.id);
                                  setPanelScope('asesor');
                                }}
                                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#C8102E] dark:text-red-400 hover:underline"
                              >
                                <History className="w-3.5 h-3.5" />
                                <span>Actividad</span>
                              </button>
                            )}
                          </td>

                          {weekDays.map((wd) => {
                            const cell = matrixCellMap.get(`${tec.id}__${wd.dateISO}`);
                            const visits = cell?.visits || [];
                            const block = cell?.block || null;
                            const hasAccepted = visits.some((v) => v.estado === 'ACEPTADA');
                            const pendingCount = visits.filter((v) => v.estado === 'PENDIENTE').length;
                            const hasPending = pendingCount > 0;

                            const cellBg = block
                              ? 'bg-slate-100/90 dark:bg-slate-800/70'
                              : hasAccepted
                                ? 'bg-red-50/75 dark:bg-red-950/25'
                                : hasPending
                                  ? 'bg-amber-50/75 dark:bg-amber-950/20'
                                  : 'bg-white dark:bg-slate-900';

                            const isFree = visits.length === 0 && !block;

                            return (
                              <td
                                key={wd.dateISO}
                                className={`p-2 min-h-[104px] h-28 border-r last:border-r-0 border-slate-200 dark:border-slate-800 transition-colors ${cellBg}`}
                              >
                                {isFree ? (
                                  canCreate && onOpenNueva ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onOpenNueva({
                                          fecha: wd.dateISO,
                                          tecnicoId: tec.id,
                                        })
                                      }
                                      aria-label={`Programar visita con ${tec.nombre} el ${wd.dateISO}`}
                                      className="w-full h-full min-h-[88px] rounded-lg flex items-center justify-center text-transparent hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20 transition-colors text-xs font-medium"
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        <Plus className="w-3.5 h-3.5" />
                                        Programar
                                      </span>
                                    </button>
                                  ) : (
                                    <div className="w-full h-full min-h-[88px]" />
                                  )
                                ) : (
                                  <div className="space-y-1.5">
                                    {pendingCount > 1 && (
                                      <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 px-1">
                                        {pendingCount} en disputa
                                      </p>
                                    )}
                                    {block && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReleaseError('');
                                          setSelectedBloqueo(block);
                                        }}
                                        className="w-full text-left px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs hover:border-slate-400 transition-colors"
                                      >
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                                          <Lock className="w-3 h-3 shrink-0" />
                                          Bloqueado
                                        </span>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                          {block.motivo}
                                        </p>
                                      </button>
                                    )}

                                    {visits.map((v) => {
                                      const cardTone =
                                        v.estado === 'ACEPTADA'
                                          ? 'border-red-200 dark:border-red-800/70 bg-white dark:bg-slate-900'
                                          : v.estado === 'RECHAZADA'
                                            ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 opacity-70'
                                            : 'border-amber-300 dark:border-amber-800/70 bg-white dark:bg-slate-900';

                                      const timeTone =
                                        v.estado === 'ACEPTADA'
                                          ? 'text-[#C8102E] dark:text-red-400'
                                          : v.estado === 'RECHAZADA'
                                            ? 'text-slate-500 dark:text-slate-400'
                                            : 'text-amber-800 dark:text-amber-300';

                                      return (
                                        <button
                                          key={v.id}
                                          type="button"
                                          onClick={() => setSelectedVisit(v)}
                                          className={`w-full text-left px-2 py-1.5 rounded-lg border shadow-2xs hover:shadow-xs transition-shadow ${cardTone}`}
                                        >
                                          <p
                                            className={`font-mono text-[11px] font-semibold tabular-nums truncate ${timeTone}`}
                                          >
                                            {v.hora_salida}–{v.hora_retorno}
                                          </p>
                                          <p className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">
                                            {v.cliente}
                                          </p>
                                        </button>
                                      );
                                    })}

                                    {!block && canCreate && onOpenNueva && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onOpenNueva({
                                            fecha: wd.dateISO,
                                            tecnicoId: tec.id,
                                          })
                                        }
                                        className="w-full py-1 rounded text-[11px] text-slate-400 hover:text-[#C8102E] dark:hover:text-red-400 hover:bg-white/80 dark:hover:bg-slate-900/80 transition-colors inline-flex items-center justify-center gap-1"
                                      >
                                        <Plus className="w-3 h-3" />
                                        <span>Añadir</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Weekly Cards (< md) */}
              <div className="md:hidden space-y-3">
                {weekDays.map((wd) => {
                  const isToday = wd.dateISO === todayISO;
                  return (
                    <div
                      key={wd.dateISO}
                      className={`rounded-xl border p-3.5 space-y-2.5 ${
                        isToday
                          ? 'border-red-200 dark:border-red-900/60 bg-red-50/30 dark:bg-red-950/10'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="font-mono text-xs font-bold text-[#061A3E] dark:text-white">
                          {wd.dayShort} {wd.dayNum} {wd.monthShort} ({wd.dateISO})
                        </span>
                        {isToday && (
                          <span className="text-xs font-semibold text-[#E10600] dark:text-red-400">
                            Hoy
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {matrixTecnicos.map((tec) => {
                          const cell = matrixCellMap.get(`${tec.id}__${wd.dateISO}`);
                          const visits = cell?.visits || [];
                          const block = cell?.block || null;

                          return (
                            <div
                              key={tec.id}
                              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-2.5 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-[#061A3E] dark:text-slate-100 truncate">
                                  {tec.nombre}
                                </span>
                                {!block && canCreate && onOpenNueva && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenNueva({
                                        fecha: wd.dateISO,
                                        tecnicoId: tec.id,
                                      })
                                    }
                                    className="min-h-[32px] px-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-[#061A3E] dark:text-slate-200 inline-flex items-center gap-1 shrink-0"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Programar
                                  </button>
                                )}
                              </div>

                              {block && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReleaseError('');
                                    setSelectedBloqueo(block);
                                  }}
                                  className="w-full text-left p-2 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs"
                                >
                                  <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                                    <Lock className="w-3 h-3" />
                                    Bloqueado: {block.motivo}
                                  </span>
                                </button>
                              )}

                              {visits.map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => setSelectedVisit(v)}
                                  className="w-full text-left p-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-0.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400 tabular-nums">
                                      {v.hora_salida}–{v.hora_retorno} · {v.codigo}
                                    </span>
                                    <EstadoTexto estado={v.estado} />
                                  </div>
                                  <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                                    {v.cliente}
                                  </p>
                                </button>
                              ))}

                              {!block && visits.length === 0 && (
                                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                                  Disponible todo el día
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* MONTHLY VIEW (when Por asesor + Mes is picked) */
            <>
              <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                  {WEEKDAYS_ES.map((d) => (
                    <div
                      key={d}
                      className="py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400 text-center"
                    >
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 dark:divide-slate-800">
                  {calendarCells.map((cell, idx) => {
                    if (!cell.dateISO || !cell.dayNum) {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="min-h-[118px] bg-slate-50/50 dark:bg-slate-950/30"
                        />
                      );
                    }
                    const entry = eventsByDate.get(cell.dateISO);
                    const visits = entry?.visits || [];
                    const blocks = entry?.blocks || [];
                    const isToday = cell.dateISO === todayISO;
                    const hasAccepted = visits.some((v) => v.estado === 'ACEPTADA');
                    const pendingCount = visits.filter((v) => v.estado === 'PENDIENTE').length;

                    const monthCellBg =
                      blocks.length > 0
                        ? 'bg-slate-100/90 dark:bg-slate-800/70'
                        : hasAccepted
                          ? 'bg-red-50/65 dark:bg-red-950/25'
                          : pendingCount > 0
                            ? 'bg-amber-50/75 dark:bg-amber-950/20'
                            : isToday
                              ? 'bg-red-50/20 dark:bg-red-950/10'
                              : '';

                    return (
                      <div
                        key={cell.dateISO}
                        className={`min-h-[118px] p-2 flex flex-col gap-1.5 ${monthCellBg}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                              isToday
                                ? 'bg-[#E10600] text-white font-semibold'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {cell.dayNum}
                          </span>
                          {pendingCount > 1 ? (
                            <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                              {pendingCount} disputa
                            </span>
                          ) : (
                            visits.length === 0 &&
                            blocks.length === 0 &&
                            canCreate &&
                            onOpenNueva && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenNueva({
                                    fecha: cell.dateISO!,
                                    tecnicoId: activeSelectedTecnicoId,
                                  })
                                }
                                className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline"
                              >
                                + Libre
                              </button>
                            )
                          )}
                        </div>

                        <div className="space-y-1 overflow-y-auto max-h-[96px]">
                          {blocks.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => {
                                setReleaseError('');
                                setSelectedBloqueo(b);
                              }}
                              className="w-full text-left px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-[11px]"
                            >
                              <span className="font-medium inline-flex items-center gap-1">
                                <Lock className="w-3 h-3" />
                                Bloqueado
                              </span>
                            </button>
                          ))}
                          {visits.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setSelectedVisit(v)}
                              className={`w-full text-left px-2 py-1 rounded-md border text-[11px] ${
                                v.estado === 'ACEPTADA'
                                  ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-[#C8102E] dark:text-red-300'
                                  : v.estado === 'RECHAZADA'
                                    ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-500'
                                    : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                              }`}
                            >
                              <div className="font-mono font-semibold truncate">
                                {v.hora_salida} {v.codigo}
                              </div>
                              <div className="truncate text-[10px]">{v.cliente}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="md:hidden space-y-3">
                {monthAgendaDates.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    No hay visitas ni bloqueos en {MONTHS_ES[month]} {year}.
                  </div>
                ) : (
                  monthAgendaDates.map(({ dateISO, visits, blocks }) => (
                    <div
                      key={dateISO}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
                    >
                      <p className="font-mono text-xs font-bold text-[#061A3E] dark:text-white">
                        {dateISO}
                      </p>
                      {blocks.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setSelectedBloqueo(b)}
                          className="w-full text-left p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        >
                          Bloqueado · {b.motivo}
                        </button>
                      ))}
                      {visits.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVisit(v)}
                          className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-[#C8102E] dark:text-red-400">
                              {v.hora_salida}–{v.hora_retorno} · {v.codigo}
                            </span>
                            <EstadoTexto estado={v.estado} />
                          </div>
                          <p className="font-medium text-slate-900 dark:text-white">{v.cliente}</p>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* Instructional Footer Caption inside Panel Card */}
          <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
            {isTecnico
              ? 'Toca una visita para ver su detalle completo, responder o preparar su reporte. Puedes bloquear días no disponibles desde Mi agenda.'
              : 'Toca una visita para ver su detalle completo, o una celda libre para programar con esa fecha ya cargada. Los asesores pueden bloquear sus días para no recibir reservas.'}
          </p>
        </div>

        {/* Modals */}
        {renderModals()}
      </div>
    );
  }

  // =========================================================================
  // RENDER MODE 2: MI AGENDA (Focused Agenda, Blockouts & Monthly Grid)
  // =========================================================================
  function renderModals() {
    return (
      <>
        {/* Visit Quick Detail Dialog */}
        {selectedVisit && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400">
                      {selectedVisit.codigo}
                    </span>
                    <EstadoTexto estado={selectedVisit.estado} />
                  </div>
                  <h3 className="font-heading text-lg font-bold text-slate-900 dark:text-white mt-1">
                    {selectedVisit.cliente}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedVisit(null)}
                  aria-label="Cerrar diálogo"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm border-y border-slate-100 dark:border-slate-800 py-3.5">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Fecha y horario</p>
                  <p className="font-mono font-medium text-slate-900 dark:text-white tabular-nums">
                    {selectedVisit.fecha} · {selectedVisit.hora_salida}–{selectedVisit.hora_retorno}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Distrito</p>
                  <p className="font-medium text-slate-900 dark:text-white">{selectedVisit.distrito}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Técnico</p>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {selectedVisit.tecnico_nombre}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Ejecutivo</p>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {selectedVisit.ejecutivo_nombre}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Contacto en sitio</p>
                  <p className="text-slate-900 dark:text-white">
                    {selectedVisit.contacto_nombre} ({selectedVisit.contacto_cargo}) ·{' '}
                    <span className="font-mono">{selectedVisit.contacto_celular}</span>
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Motivo y alcance</p>
                  <p className="text-slate-700 dark:text-slate-300 text-xs sm:text-sm">
                    {selectedVisit.motivo}: {selectedVisit.descripcion}
                  </p>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 safe-bottom">
                <button
                  type="button"
                  onClick={() => setSelectedVisit(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const code = selectedVisit.codigo;
                    setSelectedVisit(null);
                    onNavigateSolicitud(code);
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#E10600] hover:bg-[#BE0500] text-white text-sm font-medium inline-flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Ver detalle completo y acciones</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Blockout Detail & Release Dialog */}
        {selectedBloqueo && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <Lock className="w-3.5 h-3.5" />
                    Día bloqueado
                  </span>
                  <h3 className="font-heading text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {selectedBloqueo.tecnico_nombre}
                  </h3>
                  <p className="font-mono text-sm text-[#C8102E] dark:text-red-400">
                    {selectedBloqueo.fecha}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBloqueo(null)}
                  aria-label="Cerrar"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {releaseError && (
                <p className="text-xs text-red-700 dark:text-red-400">{releaseError}</p>
              )}

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 text-sm">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Motivo registrado</p>
                <p className="text-slate-900 dark:text-slate-100 selectable-text">
                  {selectedBloqueo.motivo}
                </p>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 safe-bottom">
                <button
                  type="button"
                  onClick={() => setSelectedBloqueo(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  Cerrar
                </button>
                {(currentProfile.rol === 'admin' ||
                  selectedBloqueo.tecnico_id === currentProfile.id) && (
                  <button
                    type="button"
                    disabled={releasingId === selectedBloqueo.id}
                    onClick={() => handleReleaseBloqueo(selectedBloqueo.id)}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-[#E10600] hover:bg-[#BE0500] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>
                      {releasingId === selectedBloqueo.id ? 'Liberando...' : 'Liberar bloqueo'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create Blockout Modal */}
        {blockModalOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
            role="dialog"
            aria-modal="true"
          >
            <form
              onSubmit={handleCreateBloqueo}
              className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-lg font-bold text-slate-900 dark:text-white">
                  Bloquear fecha en agenda
                </h3>
                <button
                  type="button"
                  onClick={() => setBlockModalOpen(false)}
                  aria-label="Cerrar"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {blockError && (
                <div className="p-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-xs sm:text-sm flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{blockError}</span>
                </div>
              )}

              {currentProfile.rol === 'admin' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Asesor técnico
                  </label>
                  <select
                    required
                    value={blockTecnicoId}
                    onChange={(e) => setBlockTecnicoId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    {tecnicos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Fecha a bloquear
                </label>
                <input
                  type="date"
                  required
                  value={blockFecha}
                  onChange={(e) => setBlockFecha(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Motivo detallado del bloqueo
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={blockMotivo}
                  onChange={(e) => setBlockMotivo(e.target.value)}
                  placeholder="Ej. Mantenimiento interno de laboratorio / Vacaciones / Capacitación técnica..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2 safe-bottom">
                <button
                  type="button"
                  onClick={() => setBlockModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={blockSubmitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#E10600] hover:bg-[#BE0500] text-white text-sm font-medium disabled:opacity-50"
                >
                  {blockSubmitting ? 'Guardando...' : 'Confirmar bloqueo'}
                </button>
              </div>
            </form>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 dark:text-slate-400 uppercase">
            AGENDA TÉCNICA
          </p>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-[#061A3E] dark:text-white mt-0.5">
            {isTecnico ? 'Mi Agenda y Bloqueos' : 'Agenda Técnica y Bloqueos'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Administra días no disponibles y revisa próximas visitas asignadas.
          </p>
        </div>

        {canBlock && (
          <button
            type="button"
            onClick={() => {
              setBlockError('');
              setBlockTecnicoId(
                isTecnico ? currentProfile.id : selectedTecnicoId || tecnicos[0]?.id || ''
              );
              setBlockModalOpen(true);
            }}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#061A3E] dark:bg-slate-800 hover:bg-[#0B2657] dark:hover:bg-slate-700 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Lock className="w-4 h-4" />
            <span>Bloquear día</span>
          </button>
        )}
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Pendientes de respuesta
            </p>
            <p className="font-heading text-2xl font-bold text-[#061A3E] dark:text-white mt-0.5 tabular-nums">
              {kpiStats.pendientes}
            </p>
          </div>
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Visitas aceptadas
            </p>
            <p className="font-heading text-2xl font-bold text-[#061A3E] dark:text-white mt-0.5 tabular-nums">
              {kpiStats.aceptadas}
            </p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Días bloqueados
            </p>
            <p className="font-heading text-2xl font-bold text-[#061A3E] dark:text-white mt-0.5 tabular-nums">
              {kpiStats.bloqueosCount}
            </p>
          </div>
          <Lock className="w-5 h-5 text-slate-600 dark:text-slate-300 shrink-0" />
        </div>
      </div>

      {/* Mi Agenda focused management cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="font-heading text-base font-bold text-[#061A3E] dark:text-white">
            Bloqueos registrados ({filteredBloqueos.length})
          </h2>
          {filteredBloqueos.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No hay días bloqueados registrados.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
              {filteredBloqueos.map((b) => (
                <div key={b.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400">
                      {b.fecha} · {b.tecnico_nombre}
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5 selectable-text">
                      {b.motivo}
                    </p>
                  </div>
                  {(currentProfile.rol === 'admin' || b.tecnico_id === currentProfile.id) && (
                    <button
                      type="button"
                      disabled={releasingId === b.id}
                      onClick={() => handleReleaseBloqueo(b.id)}
                      className="min-h-[38px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
                    >
                      {releasingId === b.id ? 'Liberando...' : 'Liberar'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="font-heading text-base font-bold text-[#061A3E] dark:text-white">
            Próximas visitas ({upcomingVisits.length})
          </h2>
          {upcomingVisits.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No hay próximas visitas pendientes o aceptadas desde hoy.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
              {upcomingVisits.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onNavigateSolicitud(v.codigo)}
                  className="w-full text-left py-2.5 px-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400 tabular-nums">
                      {v.fecha} · {v.hora_salida}–{v.hora_retorno} · {v.codigo}
                    </p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {v.cliente}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {v.distrito} {!isTecnico ? `· ${v.tecnico_nombre}` : ''}
                    </p>
                  </div>
                  <EstadoTexto estado={v.estado} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Month Controls & Grid */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goPrevMonth}
            aria-label="Mes anterior"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-heading font-bold text-base text-[#061A3E] dark:text-white min-w-[170px] text-center">
            {MONTHS_ES[month]} {year}
          </span>
          <button
            type="button"
            onClick={goNextMonth}
            aria-label="Mes siguiente"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setYear(now.getFullYear());
              setMonth(now.getMonth());
            }}
            className="min-h-[44px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Hoy
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!isTecnico && (
            <select
              aria-label="Filtrar por asesor técnico"
              value={selectedTecnicoId}
              onChange={(e) => setSelectedTecnicoId(e.target.value)}
              className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="">Todos los técnicos</option>
              {tecnicos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          )}

          <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showRejected}
              onChange={(e) => setShowRejected(e.target.checked)}
              className="w-4 h-4 accent-[#E10600]"
            />
            <span>Mostrar rechazadas</span>
          </label>
        </div>
      </div>

      {/* Desktop Month Grid */}
      <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
          {WEEKDAYS_ES.map((d) => (
            <div
              key={d}
              className="py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400 text-center"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 dark:divide-slate-800">
          {calendarCells.map((cell, idx) => {
            if (!cell.dateISO || !cell.dayNum) {
              return (
                <div
                  key={`empty-${idx}`}
                  className="min-h-[126px] bg-slate-50/50 dark:bg-slate-950/30"
                />
              );
            }

            const entry = eventsByDate.get(cell.dateISO);
            const visits = entry?.visits || [];
            const blocks = entry?.blocks || [];
            const isToday = cell.dateISO === todayISO;

            return (
              <div
                key={cell.dateISO}
                className={`min-h-[126px] p-2 flex flex-col gap-1.5 ${
                  isToday ? 'bg-red-50/30 dark:bg-red-950/10' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                      isToday
                        ? 'bg-[#E10600] text-white font-semibold'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {cell.dayNum}
                  </span>
                  {visits.length === 0 && blocks.length === 0 && (
                    <span className="text-[10px] text-slate-400">Disponible</span>
                  )}
                </div>

                <div className="space-y-1 overflow-y-auto max-h-[100px]">
                  {blocks.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setReleaseError('');
                        setSelectedBloqueo(b);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-[11px] hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      <div className="flex items-center gap-1 font-medium truncate">
                        <Lock className="w-3 h-3 shrink-0" />
                        <span className="truncate">{b.tecnico_nombre}</span>
                      </div>
                      <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                        {b.motivo}
                      </div>
                    </button>
                  ))}

                  {visits.map((v) => {
                    const style =
                      v.estado === 'ACEPTADA'
                        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                        : v.estado === 'RECHAZADA'
                          ? 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-300'
                          : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200';

                    const IconComp =
                      v.estado === 'ACEPTADA'
                        ? CheckCircle2
                        : v.estado === 'RECHAZADA'
                          ? XCircle
                          : Clock;

                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVisit(v)}
                        className={`w-full text-left px-2 py-1.5 rounded-md border text-[11px] transition-opacity hover:opacity-90 ${style}`}
                      >
                        <div className="flex items-center gap-1 font-mono font-medium tabular-nums truncate">
                          <IconComp className="w-3 h-3 shrink-0" />
                          <span>
                            {v.hora_salida} {v.codigo}
                          </span>
                        </div>
                        <div className="truncate text-[10px] opacity-90">{v.cliente}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile Agenda View */}
      <div className="md:hidden space-y-3">
        {monthAgendaDates.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No hay visitas ni bloqueos programados para {MONTHS_ES[month]} {year}. Todo el mes se encuentra disponible.
          </div>
        ) : (
          monthAgendaDates.map(({ dateISO, visits, blocks }) => (
            <div
              key={dateISO}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                  {dateISO}
                </span>
                {dateISO === todayISO && (
                  <span className="text-xs font-medium text-[#C8102E] dark:text-red-400">Hoy</span>
                )}
              </div>

              {blocks.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setReleaseError('');
                    setSelectedBloqueo(b);
                  }}
                  className="w-full min-h-[44px] text-left p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 space-y-1"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-200">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Bloqueado · {b.tecnico_nombre}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{b.motivo}</p>
                </button>
              ))}

              {visits.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVisit(v)}
                  className="w-full min-h-[44px] text-left p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400 tabular-nums">
                      {v.codigo} · {v.hora_salida}–{v.hora_retorno}
                    </span>
                    <EstadoTexto estado={v.estado} />
                  </div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{v.cliente}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {v.distrito} · {v.tecnico_nombre}
                  </p>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {renderModals()}
    </div>
  );
}
