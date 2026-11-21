import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Filter,
  MessageCircle,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import type { Perfil, Solicitud, SolicitudEstado } from '../types.ts';
import { EstadoTexto } from './BrandMark.tsx';

interface SolicitudesViewProps {
  solicitudes: Solicitud[];
  currentProfile: Perfil;
  tecnicos: Perfil[];
  ejecutivos: Perfil[];
  loading: boolean;
  onSelectSolicitud: (codigo: string) => void;
  onOpenNueva: () => void;
  onRefresh: () => Promise<void>;
}

export function SolicitudesView({
  solicitudes,
  currentProfile,
  tecnicos,
  ejecutivos,
  loading,
  onSelectSolicitud,
  onOpenNueva,
  onRefresh,
}: SolicitudesViewProps) {
  const [searchText, setSearchText] = useState('');
  const [estadoFilter, setEstadoFilter] = useState<'TODAS' | SolicitudEstado>('TODAS');
  const [tecnicoFilter, setTecnicoFilter] = useState('');
  const [ejecutivoFilter, setEjecutivoFilter] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [pendingAction, setPendingAction] = useState<{
    solicitud: Solicitud;
    accion: 'ACEPTAR' | 'RECHAZAR';
  } | null>(null);
  const [obsInput, setObsInput] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [bannerMsg, setBannerMsg] = useState<{
    text: string;
    whatsappUrl?: string | null;
  } | null>(null);

  const canCreate = currentProfile.rol === 'vendedor' || currentProfile.rol === 'admin';
  const isTecnico = currentProfile.rol === 'tecnico';
  const showActionsColumn = currentProfile.rol === 'admin' || currentProfile.rol === 'tecnico';

  const canRespondSolicitud = (s: Solicitud) =>
    s.estado === 'PENDIENTE' &&
    (currentProfile.rol === 'admin' ||
      (currentProfile.rol === 'tecnico' && s.tecnico_id === currentProfile.id));

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return solicitudes
      .filter((s) => {
        if (estadoFilter !== 'TODAS' && s.estado !== estadoFilter) return false;
        if (!isTecnico && tecnicoFilter && s.tecnico_id !== tecnicoFilter) return false;
        if (!isTecnico && ejecutivoFilter && s.ejecutivo_email.toLowerCase() !== ejecutivoFilter.toLowerCase()) {
          return false;
        }
        if (fechaDesde && s.fecha < fechaDesde) return false;
        if (fechaHasta && s.fecha > fechaHasta) return false;
        if (q) {
          const hay = `${s.codigo} ${s.cliente} ${s.distrito} ${s.tecnico_nombre} ${s.ejecutivo_nombre} ${s.contacto_nombre} ${s.observacion}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [solicitudes, searchText, estadoFilter, tecnicoFilter, ejecutivoFilter, fechaDesde, fechaHasta, isTecnico]);

  const counts = useMemo(() => {
    let pend = 0;
    let acep = 0;
    let rech = 0;
    for (const s of solicitudes) {
      if (s.estado === 'PENDIENTE') pend++;
      else if (s.estado === 'ACEPTADA') acep++;
      else if (s.estado === 'RECHAZADA') rech++;
    }
    return { total: solicitudes.length, pend, acep, rech };
  }, [solicitudes]);

  const clearFilters = () => {
    setSearchText('');
    setEstadoFilter('TODAS');
    setTecnicoFilter('');
    setEjecutivoFilter('');
    setFechaDesde('');
    setFechaHasta('');
  };

  const hasActiveFilters = Boolean(
    searchText || estadoFilter !== 'TODAS' || tecnicoFilter || ejecutivoFilter || fechaDesde || fechaHasta
  );

  const openActionDialog = (solicitud: Solicitud, accion: 'ACEPTAR' | 'RECHAZAR') => {
    setPendingAction({ solicitud, accion });
    setObsInput('');
    setActionError('');
  };

  const handleConfirmAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAction) return;
    setActionError('');
    setActionSubmitting(true);
    try {
      const res = await apiRequest<{
        solicitud: Solicitud;
        autoRejectedCount: number;
        whatsappVendedorUrl?: string | null;
      }>(`/api/solicitudes/${pendingAction.solicitud.id}/responder`, {
        method: 'POST',
        body: JSON.stringify({
          accion: pendingAction.accion,
          observacion: obsInput.trim(),
        }),
      });
      const autoNote =
        res.autoRejectedCount > 0
          ? ` Se rechazaron automáticamente ${res.autoRejectedCount} solicitud(es) en cruce horario.`
          : '';
      setBannerMsg({
        text:
          pendingAction.accion === 'ACEPTAR'
            ? `Visita ${pendingAction.solicitud.codigo} aceptada correctamente.${autoNote}`
            : `Visita ${pendingAction.solicitud.codigo} rechazada.`,
        whatsappUrl: res.whatsappVendedorUrl,
      });
      setPendingAction(null);
      setObsInput('');
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'No se pudo procesar la respuesta.');
    } finally {
      setActionSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
            Bandeja de Solicitudes
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 tabular-nums">
            {isTecnico
              ? `Mostrando tu actividad asignada · ${counts.pend} pendientes · ${counts.acep} aceptadas`
              : `${counts.total} registros · ${counts.pend} pendientes · ${counts.acep} aceptadas · ${counts.rech} rechazadas`}
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={onOpenNueva}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva solicitud</span>
          </button>
        )}
      </div>

      {bannerMsg && (
        <div
          role="status"
          className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-sm flex flex-wrap items-center justify-between gap-2.5"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{bannerMsg.text}</span>
          </div>
          <div className="flex items-center gap-2">
            {bannerMsg.whatsappUrl && (
              <a
                href={bannerMsg.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>Notificar por WhatsApp</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => setBannerMsg(null)}
              aria-label="Cerrar aviso"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Filter & Search Toolbar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar por código VIS, cliente, distrito, técnico o contacto..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
              {(['TODAS', 'PENDIENTE', 'ACEPTADA', 'RECHAZADA'] as const).map((est) => (
                <button
                  key={est}
                  type="button"
                  onClick={() => setEstadoFilter(est)}
                  className={`min-h-[36px] px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    estadoFilter === est
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {est === 'TODAS' ? 'Todas' : est.charAt(0) + est.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`min-h-[44px] px-3.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                showFilters || fechaDesde || fechaHasta || tecnicoFilter || ejecutivoFilter
                  ? 'border-[#C8102E] text-[#C8102E] dark:text-red-400 bg-red-50/50 dark:bg-red-950/20'
                  : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>Filtros</span>
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Desde fecha
              </label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 font-mono text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Hasta fecha
              </label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 font-mono text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            {!isTecnico && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Asesor técnico
                  </label>
                  <select
                    value={tecnicoFilter}
                    onChange={(e) => setTecnicoFilter(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Todos los técnicos</option>
                    {tecnicos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Ejecutivo comercial
                  </label>
                  <select
                    value={ejecutivoFilter}
                    onChange={(e) => setEjecutivoFilter(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Todos los ejecutivos</option>
                    {ejecutivos.map((ex) => (
                      <option key={ex.id} value={ex.email}>
                        {ex.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-1">
            <span>Mostrando {filtered.length} resultados filtrados</span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-[#C8102E] dark:text-red-400 hover:underline min-h-[32px]"
            >
              <X className="w-3.5 h-3.5" />
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {loading && solicitudes.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="p-4 animate-pulse flex items-center justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-3.5 w-64 bg-slate-100 dark:bg-slate-800/70 rounded" />
              </div>
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 mx-auto flex items-center justify-center">
            <Calendar className="w-5 h-5" />
          </div>
          <h2 className="font-heading text-base font-bold text-slate-900 dark:text-white">
            Sin solicitudes para mostrar
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {hasActiveFilters
              ? 'No hay visitas que coincidan con los filtros actuales. Prueba limpiar los filtros.'
              : 'Aún no existen solicitudes registradas en esta vista.'}
          </p>
          {canCreate && !hasActiveFilters && (
            <button
              type="button"
              onClick={onOpenNueva}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Crear primera solicitud
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Data Table */}
          <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4">Código</th>
                    <th className="py-3 px-4">Cliente y distrito</th>
                    <th className="py-3 px-4">Fecha y horario</th>
                    <th className="py-3 px-4">Asesor técnico</th>
                    <th className="py-3 px-4">Ejecutivo</th>
                    <th className="py-3 px-4">Estado</th>
                    <th className="py-3 px-4">Observación</th>
                    {showActionsColumn && <th className="py-3 px-4">Acciones</th>}
                    <th className="py-3 px-4 text-right">Reporte</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {filtered.map((s) => {
                    const rowCanRespond = canRespondSolicitud(s);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => onSelectSolicitud(s.codigo)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono font-semibold text-[#C8102E] dark:text-red-400 tabular-nums whitespace-nowrap">
                          {s.codigo}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {s.cliente}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {s.distrito} · {s.motivo}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          <div>{s.fecha}</div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {s.hora_salida} – {s.hora_retorno}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                          {s.tecnico_nombre}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                          {s.ejecutivo_nombre}
                        </td>
                        <td className="py-3.5 px-4">
                          <EstadoTexto estado={s.estado} />
                        </td>
                        <td
                          className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300 max-w-[220px]"
                          title={s.observacion || ''}
                        >
                          <span className="line-clamp-2">
                            {s.observacion ? s.observacion : '—'}
                          </span>
                        </td>
                        {showActionsColumn && (
                          <td
                            className="py-3.5 px-4 whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rowCanRespond ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  title="Aceptar solicitud"
                                  onClick={() => openActionDialog(s, 'ACEPTAR')}
                                  className="min-h-[34px] px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1 transition-colors"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Aceptar</span>
                                </button>
                                <button
                                  type="button"
                                  title="Rechazar solicitud"
                                  onClick={() => openActionDialog(s, 'RECHAZAR')}
                                  className="min-h-[34px] px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium inline-flex items-center gap-1 transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>Rechazar</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        )}
                        <td className="py-3.5 px-4 text-right text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {s.reporte_estado === 'ENVIADO'
                            ? 'Enviado'
                            : s.reporte_estado === 'BORRADOR'
                              ? 'Borrador'
                              : s.estado === 'ACEPTADA'
                                ? 'Pendiente'
                                : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Touch Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((s) => {
              const rowCanRespond = canRespondSolicitud(s);
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSolicitud(s.codigo)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectSolicitud(s.codigo);
                    }
                  }}
                  className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5 cursor-pointer active:scale-[0.99] transition-transform"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400 tabular-nums">
                      {s.codigo}
                    </span>
                    <EstadoTexto estado={s.estado} />
                  </div>

                  <div>
                    <h3 className="font-heading text-base font-bold text-slate-900 dark:text-white leading-snug">
                      {s.cliente}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {s.distrito} · {s.motivo}
                    </p>
                  </div>

                  {s.observacion && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 rounded-lg px-2.5 py-2 selectable-text">
                      <span className="font-semibold">Obs.:</span> {s.observacion}
                    </p>
                  )}

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-mono tabular-nums">
                      {s.fecha} · {s.hora_salida}–{s.hora_retorno}
                    </span>
                    <span className="truncate max-w-[180px]">{s.tecnico_nombre}</span>
                  </div>

                  {rowCanRespond && (
                    <div
                      className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => openActionDialog(s, 'ACEPTAR')}
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        <span>Aceptar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openActionDialog(s, 'RECHAZAR')}
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <X className="w-4 h-4" />
                        <span>Rechazar</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Confirm Inline Accept / Reject Modal */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmAction}
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400">
                  {pendingAction.solicitud.codigo}
                </p>
                <h2 className="font-heading text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {pendingAction.accion === 'ACEPTAR'
                    ? 'Confirmar aceptación de visita'
                    : 'Confirmar rechazo de visita'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 p-3.5 text-sm space-y-1">
              <p className="font-medium text-slate-900 dark:text-white">
                {pendingAction.solicitud.cliente}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {pendingAction.solicitud.distrito} · {pendingAction.solicitud.motivo}
              </p>
              <p className="font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums pt-0.5">
                {pendingAction.solicitud.fecha} · {pendingAction.solicitud.hora_salida}–
                {pendingAction.solicitud.hora_retorno}
              </p>
            </div>

            {actionError && (
              <div
                role="alert"
                className="p-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-xs sm:text-sm flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="quick-obs"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Observación (opcional)
              </label>
              <textarea
                id="quick-obs"
                rows={3}
                value={obsInput}
                onChange={(e) => setObsInput(e.target.value)}
                placeholder={
                  pendingAction.accion === 'ACEPTAR'
                    ? 'Ej. Confirmado, llevar manómetros calibrados...'
                    : 'Ej. Horario ocupado por soporte prioritario en planta...'
                }
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            {pendingAction.accion === 'ACEPTAR' && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Si existen otras solicitudes pendientes en conflicto para el mismo técnico y horario, serán rechazadas automáticamente.
              </p>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2 safe-bottom">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={actionSubmitting}
                className={`min-h-[44px] px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${
                  pendingAction.accion === 'ACEPTAR'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-[#C8102E] hover:bg-[#A50D26]'
                }`}
              >
                {actionSubmitting
                  ? 'Procesando...'
                  : pendingAction.accion === 'ACEPTAR'
                    ? 'Confirmar aceptación'
                    : 'Confirmar rechazo'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
