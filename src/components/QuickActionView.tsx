import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  MessageCircle,
  User,
  XCircle,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import type { Solicitud } from '../types.ts';
import { EstadoTexto, MipersaWordmark } from './BrandMark.tsx';

interface QuickActionViewProps {
  search: string;
  authenticated: boolean;
  onNavigate: (to: string) => void;
  onActionCompleted?: () => Promise<void>;
}

interface QuickActionPreview {
  valid: boolean;
  accion: 'ACEPTAR' | 'RECHAZAR';
  canConfirm: boolean;
  solicitud: Solicitud;
  tecnicoNombre: string;
}

export function QuickActionView({
  search,
  authenticated,
  onNavigate,
  onActionCompleted,
}: QuickActionViewProps) {
  const token = new URLSearchParams(search).get('token') || '';

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<QuickActionPreview | null>(null);
  const [selectedAccion, setSelectedAccion] = useState<'ACEPTAR' | 'RECHAZAR'>('ACEPTAR');
  const [observacion, setObservacion] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<{
    solicitud: Solicitud;
    autoRejectedCount: number;
    whatsappVendedorUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setErrorMsg('No se encontró un token válido de respuesta rápida en el enlace.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMsg('');

    apiRequest<QuickActionPreview>(
      `/api/solicitudes/quick-action?token=${encodeURIComponent(token)}`
    )
      .then((res) => {
        if (!cancelled) {
          setPreview(res);
          setSelectedAccion(res.accion);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            err instanceof ApiError
              ? err.message
              : 'No se pudo validar el enlace de respuesta rápida.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        solicitud: Solicitud;
        autoRejectedCount: number;
        whatsappVendedorUrl?: string | null;
      }>('/api/solicitudes/quick-action', {
        method: 'POST',
        body: JSON.stringify({
          token,
          accion: selectedAccion,
          observacion: observacion.trim(),
        }),
      });

      setCompleted({
        solicitud: res.solicitud,
        autoRejectedCount: res.autoRejectedCount || 0,
        whatsappVendedorUrl: res.whatsappVendedorUrl || null,
      });
      if (onActionCompleted) {
        await onActionCompleted().catch(() => {});
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : 'No se pudo registrar la respuesta para esta solicitud.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5 sm:p-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2 border-b border-slate-100 dark:border-slate-800 pb-5">
          <MipersaWordmark boxed />
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 dark:text-slate-400 uppercase pt-1">
            Respuesta rápida de visita técnica
          </p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Validando enlace de solicitud...
          </div>
        ) : completed ? (
          <div className="space-y-5">
            <div
              className={`p-4 rounded-xl border flex items-start gap-3 ${
                completed.solicitud.estado === 'ACEPTADA'
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                  : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
              }`}
            >
              {completed.solicitud.estado === 'ACEPTADA' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 text-sm">
                <p className="font-bold">
                  Solicitud {completed.solicitud.codigo}{' '}
                  {completed.solicitud.estado === 'ACEPTADA' ? 'ACEPTADA' : 'RECHAZADA'}
                </p>
                <p>
                  {completed.solicitud.cliente} · {completed.solicitud.fecha} (
                  {completed.solicitud.hora_salida}–{completed.solicitud.hora_retorno})
                </p>
                {completed.solicitud.observacion && (
                  <p className="text-xs opacity-90">
                    Observación: {completed.solicitud.observacion}
                  </p>
                )}
                {completed.autoRejectedCount > 0 && (
                  <p className="text-xs font-medium pt-1">
                    Se rechazaron automáticamente {completed.autoRejectedCount} solicitud(es)
                    pendiente(s) en conflicto horario.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              {completed.whatsappVendedorUrl && (
                <a
                  href={completed.whatsappVendedorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Notificar al vendedor por WhatsApp</span>
                </a>
              )}
              <button
                type="button"
                onClick={() =>
                  onNavigate(
                    authenticated
                      ? `/solicitudes/${encodeURIComponent(completed.solicitud.codigo)}`
                      : '/login'
                  )
                }
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span>{authenticated ? 'Ver detalle en sistema' : 'Ir al portal MIPERSA'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : errorMsg && !preview ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(authenticated ? '/panel' : '/login')}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium"
            >
              {authenticated ? 'Volver al Panel' : 'Iniciar sesión en MIPERSA'}
            </button>
          </div>
        ) : preview ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400">
                  {preview.solicitud.codigo}
                </p>
                <h1 className="font-heading text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                  {preview.solicitud.cliente}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {preview.solicitud.distrito} · {preview.solicitud.motivo}
                  {preview.solicitud.motivo === 'Otro' && preview.solicitud.motivo_otro
                    ? ` (${preview.solicitud.motivo_otro})`
                    : ''}
                </p>
              </div>
              <EstadoTexto estado={preview.solicitud.estado} />
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Fecha y horario
                </p>
                <p className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {preview.solicitud.fecha} · {preview.solicitud.hora_salida}–
                  {preview.solicitud.hora_retorno}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  Ejecutivo comercial
                </p>
                <p className="font-medium text-slate-900 dark:text-white mt-0.5">
                  {preview.solicitud.ejecutivo_nombre}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">Contacto en sitio</p>
                <p className="text-slate-800 dark:text-slate-200 mt-0.5">
                  {preview.solicitud.contacto_nombre} ({preview.solicitud.contacto_cargo}) ·{' '}
                  <span className="font-mono">{preview.solicitud.contacto_celular}</span>
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">Descripción</p>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5 text-justify selectable-text">
                  {preview.solicitud.descripcion}
                </p>
              </div>
            </div>

            {!preview.canConfirm ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-sm">
                  Esta solicitud ya fue respondida previamente ({preview.solicitud.estado}) y no
                  admite cambios adicionales.
                  {preview.solicitud.observacion && (
                    <p className="text-xs mt-1">
                      Observación registrada: {preview.solicitud.observacion}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(
                      authenticated
                        ? `/solicitudes/${encodeURIComponent(preview.solicitud.codigo)}`
                        : '/login'
                    )
                  }
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#061A3E] hover:bg-[#0B2657] text-white text-sm font-medium"
                >
                  {authenticated ? 'Ver solicitud en el sistema' : 'Ir al portal MIPERSA'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleConfirm} className="space-y-4">
                {errorMsg && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div>
                  <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Decisión para {preview.tecnicoNombre}
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedAccion('ACEPTAR')}
                      className={`min-h-[44px] px-3 py-2 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                        selectedAccion === 'ACEPTAR'
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Aceptar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedAccion('RECHAZAR')}
                      className={`min-h-[44px] px-3 py-2 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                        selectedAccion === 'RECHAZAR'
                          ? 'border-[#C8102E] bg-[#C8102E] text-white'
                          : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Rechazar</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="qa-obs"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Observación (opcional)
                  </label>
                  <textarea
                    id="qa-obs"
                    rows={3}
                    value={observacion}
                    onChange={(e) => setObservacion(e.target.value)}
                    placeholder="Agrega una nota breve para el vendedor (opcional)..."
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full min-h-[44px] px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-50 ${
                    selectedAccion === 'ACEPTAR'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-[#C8102E] hover:bg-[#A50D26]'
                  }`}
                >
                  {submitting
                    ? 'Registrando decisión...'
                    : selectedAccion === 'ACEPTAR'
                      ? 'Confirmar aceptación'
                      : 'Confirmar rechazo'}
                </button>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
