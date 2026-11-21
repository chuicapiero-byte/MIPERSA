import { AlertCircle, ClipboardList, Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import type { HistorialItem } from '../types.ts';

export function AuditoriaView() {
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('TODAS');

  const loadAuditoria = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiRequest<{ historial: HistorialItem[] }>('/api/auditoria');
      setHistorial(res.historial);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo cargar el registro de auditoría.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuditoria();
  }, [loadAuditoria]);

  const actionTypes = useMemo(() => {
    const set = new Set(historial.map((h) => h.tipo_accion));
    return Array.from(set).sort();
  }, [historial]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return historial.filter((h) => {
      if (actionFilter !== 'TODAS' && h.tipo_accion !== actionFilter) return false;
      if (!q) return true;
      return `${h.codigo_visita} ${h.usuario_nombre} ${h.usuario_email} ${h.tipo_accion} ${h.detalle}`
        .toLowerCase()
        .includes(q);
    });
  }, [historial, search, actionFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
            Auditoría del Sistema
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Trazabilidad cronológica de visitas, cambios de estado, roles, carteras y catálogos.
          </p>
        </div>

        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {filtered.length} eventos registrados
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código VIS, correo, usuario, acción o detalle..."
            className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          />
        </div>

        <select
          aria-label="Filtrar por tipo de acción"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
        >
          <option value="TODAS">Todas las acciones</option>
          {actionTypes.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Cargando registro de auditoría...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
            <ClipboardList className="w-6 h-6 text-slate-400" />
            <span>No se encontraron registros con los filtros actuales.</span>
          </div>
        ) : (
          filtered.map((h) => (
            <div
              key={h.id}
              className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-[#C8102E] dark:text-red-400">
                    {h.codigo_visita}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {h.tipo_accion.replace(/_/g, ' ')}
                  </span>
                  {(h.estado_anterior || h.estado_nuevo) && (
                    <>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {h.estado_anterior || '—'} → {h.estado_nuevo || '—'}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 selectable-text">
                  {h.detalle}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {h.usuario_nombre} ({h.usuario_email})
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                {new Date(h.fecha_registro).toLocaleString('es-PE')}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
