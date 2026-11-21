import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  History,
  MessageCircle,
  Trash2,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import type { FileRef, HistorialItem, Perfil, Reporte, Solicitud } from '../types.ts';
import { EstadoTexto } from './BrandMark.tsx';
import { ReporteDialog } from './ReporteDialog.tsx';

interface SolicitudDetailViewProps {
  codigo: string;
  currentProfile: Perfil;
  margenMinutos: number;
  onBack: () => void;
  onGlobalRefresh: () => Promise<void>;
}

interface DetailResponse {
  solicitud: Solicitud;
  reporte: Reporte | null;
  historial: HistorialItem[];
  whatsappTecnicoUrl: string | null;
  whatsappContactoUrl: string | null;
}

export function SolicitudDetailView({
  codigo,
  currentProfile,
  margenMinutos,
  onBack,
  onGlobalRefresh,
}: SolicitudDetailViewProps) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [lastWhatsappVendedorUrl, setLastWhatsappVendedorUrl] = useState<string | null>(null);

  const [observacion, setObservacion] = useState('');
  const [responding, setResponding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [lightboxImg, setLightboxImg] = useState<FileRef | null>(null);
  const [reporteOpen, setReporteOpen] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      setErrorMsg('');
      const res = await apiRequest<DetailResponse>(`/api/solicitudes/${encodeURIComponent(codigo)}`);
      setData(res);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo cargar la solicitud.');
    } finally {
      setLoading(false);
    }
  }, [codigo]);

  useEffect(() => {
    setLoading(true);
    fetchDetail();
  }, [fetchDetail]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-40 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-64 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <p className="text-sm text-red-700 dark:text-red-400">
          {errorMsg || 'Solicitud no encontrada.'}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a la bandeja
        </button>
      </div>
    );
  }

  const { solicitud, reporte, historial, whatsappTecnicoUrl, whatsappContactoUrl } = data;

  const canRespond =
    solicitud.estado === 'PENDIENTE' &&
    (currentProfile.rol === 'admin' ||
      (currentProfile.rol === 'tecnico' && currentProfile.id === solicitud.tecnico_id));

  const canReport =
    solicitud.estado === 'ACEPTADA' &&
    (currentProfile.rol === 'admin' ||
      (currentProfile.rol === 'tecnico' && currentProfile.id === solicitud.tecnico_id));

  const canDelete =
    currentProfile.rol === 'admin' ||
    (currentProfile.rol === 'vendedor' &&
      solicitud.estado === 'PENDIENTE' &&
      solicitud.ejecutivo_email.toLowerCase() === currentProfile.email.toLowerCase());

  const handleResponder = async (accion: 'ACEPTAR' | 'RECHAZAR') => {
    setErrorMsg('');
    setActionMsg('');
    setLastWhatsappVendedorUrl(null);
    setResponding(true);
    try {
      const res = await apiRequest<{
        solicitud: Solicitud;
        autoRejectedCount: number;
        whatsappVendedorUrl?: string | null;
      }>(`/api/solicitudes/${solicitud.id}/responder`, {
        method: 'POST',
        body: JSON.stringify({ accion, observacion: observacion.trim() }),
      });

      const autoNote =
        res.autoRejectedCount > 0
          ? ` Se rechazaron automáticamente ${res.autoRejectedCount} solicitud(es) pendiente(s) en conflicto.`
          : '';

      setActionMsg(
        accion === 'ACEPTAR'
          ? `Visita ${solicitud.codigo} aceptada correctamente.${autoNote}`
          : `Visita ${solicitud.codigo} rechazada.`
      );
      setLastWhatsappVendedorUrl(res.whatsappVendedorUrl || null);
      setObservacion('');
      await Promise.all([fetchDetail(), onGlobalRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo procesar la respuesta.');
    } finally {
      setResponding(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setErrorMsg('');
    try {
      await apiRequest(`/api/solicitudes/${solicitud.id}`, { method: 'DELETE' });
      await onGlobalRefresh();
      onBack();
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo eliminar la solicitud.');
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Back & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-medium inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a bandeja</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {canReport && (
            <button
              type="button"
              onClick={() => setReporteOpen(true)}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium inline-flex items-center gap-2 transition-colors"
            >
              <FileText className="w-4 h-4" />
              <span>
                {reporte
                  ? reporte.estado_envio === 'ENVIADO'
                    ? 'Ver / Actualizar reporte'
                    : 'Continuar reporte técnico'
                  : 'Completar reporte técnico'}
              </span>
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-400 text-sm font-medium inline-flex items-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="w-4 h-4" />
              <span>Eliminar</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {actionMsg && (
        <div
          role="status"
          className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-sm flex flex-wrap items-center justify-between gap-2.5"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{actionMsg}</span>
          </div>
          {lastWhatsappVendedorUrl && (
            <a
              href={lastWhatsappVendedorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1.5 shrink-0"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Avisar por WhatsApp al vendedor</span>
            </a>
          )}
        </div>
      )}

      {/* Main Summary Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2.5 text-xs font-mono text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-[#C8102E] dark:text-red-400">{solicitud.codigo}</span>
              <span>·</span>
              <span>Registrada {new Date(solicitud.created_at).toLocaleString('es-PE')}</span>
            </div>
            <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {solicitud.cliente}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              {solicitud.distrito} · {solicitud.motivo}
              {solicitud.motivo === 'Otro' && solicitud.motivo_otro
                ? ` (${solicitud.motivo_otro})`
                : ''}
            </p>
          </div>
          <EstadoTexto estado={solicitud.estado} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 text-sm">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Fecha y horario
            </p>
            <p className="font-mono font-medium text-slate-900 dark:text-white tabular-nums">
              {solicitud.fecha} · {solicitud.hora_salida} – {solicitud.hora_retorno}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Margen de traslado: ±{margenMinutos} min
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              Asesor técnico asignado
            </p>
            <p className="font-medium text-slate-900 dark:text-white">{solicitud.tecnico_nombre}</p>
            {whatsappTecnicoUrl && (
              <a
                href={whatsappTecnicoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline mt-1"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Coordinar por WhatsApp
              </a>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Ejecutivo comercial
            </p>
            <p className="font-medium text-slate-900 dark:text-white">{solicitud.ejecutivo_nombre}</p>
            <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {solicitud.ejecutivo_email}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Contacto en cliente
            </p>
            <p className="font-medium text-slate-900 dark:text-white">
              {solicitud.contacto_nombre}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {solicitud.contacto_cargo} · <span className="font-mono">{solicitud.contacto_celular}</span>
            </p>
            {whatsappContactoUrl && (
              <a
                href={whatsappContactoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline mt-1"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                WhatsApp contacto
              </a>
            )}
          </div>

          {solicitud.respondido_por && (
            <div className="md:col-span-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Respuesta de agenda
              </p>
              <p className="text-sm text-slate-900 dark:text-white selectable-text">
                {solicitud.observacion || 'Sin observación registrada.'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                Por {solicitud.respondido_por} ·{' '}
                {solicitud.fecha_respuesta
                  ? new Date(solicitud.fecha_respuesta).toLocaleString('es-PE')
                  : ''}
              </p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Descripción y alcance de la visita
          </p>
          <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed text-justify selectable-text">
            {solicitud.descripcion}
          </p>
        </div>

        {/* Galería de imágenes adjuntas */}
        {solicitud.imagenes.length > 0 && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2.5">
              Imágenes adjuntas de referencia ({solicitud.imagenes.length})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {solicitud.imagenes.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setLightboxImg(img)}
                  className="aspect-square rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800 hover:opacity-90 transition-opacity"
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Responder Solicitud Panel */}
      {canRespond && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="font-heading text-base font-bold text-slate-900 dark:text-white">
              Responder solicitud pendiente
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Al aceptar, el servidor validará nuevamente tu disponibilidad (±{margenMinutos} min) y rechazará automáticamente otras solicitudes pendientes en conflicto.
            </p>
          </div>

          <div>
            <label
              htmlFor="resp-obs"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Observación de respuesta (opcional)
            </label>
            <textarea
              id="resp-obs"
              rows={2}
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              placeholder="Ej. Agenda confirmada / No disponible por mantenimiento programado..."
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              disabled={responding}
              onClick={() => handleResponder('ACEPTAR')}
              className="min-h-[44px] px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{responding ? 'Procesando...' : 'Aceptar visita'}</span>
            </button>
            <button
              type="button"
              disabled={responding}
              onClick={() => handleResponder('RECHAZAR')}
              className="min-h-[44px] px-5 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              <span>Rechazar solicitud</span>
            </button>
          </div>
        </div>
      )}

      {/* Resumen de Reporte Técnico (si existe) */}
      {reporte && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h2 className="font-heading text-base font-bold text-slate-900 dark:text-white">
                Reporte Técnico Asociado
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                Culminación: {reporte.fecha_culminacion} {reporte.hora_culminacion} · Estado:{' '}
                {reporte.estado_envio}
              </p>
            </div>
            {canReport && (
              <button
                type="button"
                onClick={() => setReporteOpen(true)}
                className="min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Abrir diálogo del reporte
              </button>
            )}
          </div>

          <div>
            <h3 className="text-xs font-bold text-[#B91C1C] mb-1.5">ACTIVIDADES REALIZADAS</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-slate-800 dark:text-slate-200 text-justify selectable-text">
              {reporte.actividades.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
            {reporte.imagenes_actividades.length > 0 && (
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {reporte.imagenes_actividades.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setLightboxImg(img)}
                    className="aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
                  >
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {reporte.recomendaciones && (
            <div>
              <h3 className="text-xs font-bold text-[#B91C1C] mb-1">RECOMENDACIONES</h3>
              <p className="text-sm text-slate-800 dark:text-slate-200 text-justify whitespace-pre-line selectable-text">
                {reporte.recomendaciones}
              </p>
              {reporte.imagenes_recomendaciones.length > 0 && (
                <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {reporte.imagenes_recomendaciones.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setLightboxImg(img)}
                      className="aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
                    >
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {reporte.pendientes && (
            <div>
              <h3 className="text-xs font-bold text-[#B91C1C] mb-1">PENDIENTES</h3>
              <p className="text-sm text-slate-800 dark:text-slate-200 text-justify whitespace-pre-line selectable-text">
                {reporte.pendientes}
              </p>
              {reporte.imagenes_pendientes.length > 0 && (
                <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {reporte.imagenes_pendientes.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setLightboxImg(img)}
                      className="aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
                    >
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {reporte.email_detalle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
              {reporte.email_detalle}
            </p>
          )}
        </div>
      )}

      {/* Historial cronológico */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
        <h2 className="font-heading text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <History className="w-4 h-4 text-[#C8102E]" />
          <span>Historial de eventos</span>
        </h2>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {historial.map((h) => (
            <div key={h.id} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {h.tipo_accion.replace(/_/g, ' ')}
                  {h.estado_anterior || h.estado_nuevo ? (
                    <span className="ml-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                      {h.estado_anterior || 'INICIO'} → {h.estado_nuevo || ''}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 selectable-text">
                  {h.detalle}
                </p>
                <p className="text-xs text-slate-400">
                  {h.usuario_nombre} ({h.usuario_email})
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(h.fecha_registro).toLocaleString('es-PE')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxImg(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative max-w-4xl max-h-[90dvh] w-full flex flex-col items-center">
            <button
              type="button"
              onClick={() => setLightboxImg(null)}
              aria-label="Cerrar imagen"
              className="self-end mb-2 min-h-[44px] min-w-[44px] rounded-lg bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={lightboxImg.url}
              alt={lightboxImg.name}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[80dvh] w-auto max-w-full rounded-xl object-contain"
            />
            <p className="mt-2 text-xs text-slate-300">{lightboxImg.name}</p>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="font-heading text-lg font-bold text-slate-900 dark:text-white">
              Eliminar solicitud {solicitud.codigo}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Esta acción eliminará la solicitud, sus archivos adjuntos, el reporte asociado y su historial de forma permanente.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white text-sm font-medium disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Confirmar eliminación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reporte Técnico Dialog */}
      <ReporteDialog
        open={reporteOpen}
        onClose={() => setReporteOpen(false)}
        solicitud={solicitud}
        existingReporte={reporte}
        onSaved={async () => {
          await Promise.all([fetchDetail(), onGlobalRefresh()]);
        }}
      />
    </div>
  );
}
