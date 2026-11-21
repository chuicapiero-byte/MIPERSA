import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  ImagePlus,
  Mail,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { ApiError, apiRequest, uploadPrivateImages } from '../lib/api.ts';
import type { FileRef, Reporte, Solicitud } from '../types.ts';

interface ReporteDialogProps {
  open: boolean;
  onClose: () => void;
  solicitud: Solicitud;
  existingReporte: Reporte | null;
  onSaved: (reporte: Reporte) => Promise<void> | void;
}

interface SectionImagesState {
  existing: FileRef[];
  pending: Array<{ localId: string; file: File; previewUrl: string }>;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ReporteDialog({
  open,
  onClose,
  solicitud,
  existingReporte,
  onSaved,
}: ReporteDialogProps) {
  const [actividades, setActividades] = useState<string[]>(['']);
  const [recomendaciones, setRecomendaciones] = useState('');
  const [pendientes, setPendientes] = useState('');
  const [fechaCulminacion, setFechaCulminacion] = useState(solicitud.fecha || todayISO());
  const [horaCulminacion, setHoraCulminacion] = useState(solicitud.hora_retorno || nowHHMM());

  const [imgActividades, setImgActividades] = useState<SectionImagesState>({ existing: [], pending: [] });
  const [imgRecomendaciones, setImgRecomendaciones] = useState<SectionImagesState>({ existing: [], pending: [] });
  const [imgPendientes, setImgPendientes] = useState<SectionImagesState>({ existing: [], pending: [] });

  const [reviewMode, setReviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultBanner, setResultBanner] = useState<{
    type: 'draft' | 'sent';
    title: string;
    detail: string;
    emailSent?: boolean;
    pdfGenerated?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    setReviewMode(false);
    if (existingReporte) {
      setActividades(
        existingReporte.actividades.length > 0 ? existingReporte.actividades : ['']
      );
      setRecomendaciones(existingReporte.recomendaciones || '');
      setPendientes(existingReporte.pendientes || '');
      setFechaCulminacion(existingReporte.fecha_culminacion || solicitud.fecha || todayISO());
      setHoraCulminacion(existingReporte.hora_culminacion || solicitud.hora_retorno || nowHHMM());
      setImgActividades({ existing: existingReporte.imagenes_actividades || [], pending: [] });
      setImgRecomendaciones({ existing: existingReporte.imagenes_recomendaciones || [], pending: [] });
      setImgPendientes({ existing: existingReporte.imagenes_pendientes || [], pending: [] });
      if (existingReporte.estado_envio === 'ENVIADO') {
        setResultBanner({
          type: 'sent',
          title: 'Reporte emitido previamente',
          detail: existingReporte.email_detalle || 'PDF generado en servidor.',
          emailSent: existingReporte.email_enviado,
          pdfGenerated: Boolean(existingReporte.pdf_generado_at),
        });
      } else {
        setResultBanner(null);
      }
    } else {
      setActividades(['']);
      setRecomendaciones('');
      setPendientes('');
      setFechaCulminacion(solicitud.fecha || todayISO());
      setHoraCulminacion(solicitud.hora_retorno || nowHHMM());
      setImgActividades({ existing: [], pending: [] });
      setImgRecomendaciones({ existing: [], pending: [] });
      setImgPendientes({ existing: [], pending: [] });
      setResultBanner(null);
    }
  }, [open, existingReporte, solicitud]);

  if (!open) return null;

  const addPendingToSection = (
    setter: React.Dispatch<React.SetStateAction<SectionImagesState>>,
    filesList: FileList | null
  ) => {
    if (!filesList) return;
    const files = Array.from(filesList);
    setter((prev) => {
      const total = prev.existing.length + prev.pending.length;
      const room = Math.max(0, 6 - total);
      const nextPending = files.slice(0, room).map((file) => ({
        localId: `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return { ...prev, pending: [...prev.pending, ...nextPending] };
    });
  };

  const removeExistingFromSection = (
    setter: React.Dispatch<React.SetStateAction<SectionImagesState>>,
    id: string
  ) => {
    setter((prev) => ({
      ...prev,
      existing: prev.existing.filter((f) => f.id !== id),
    }));
  };

  const removePendingFromSection = (
    setter: React.Dispatch<React.SetStateAction<SectionImagesState>>,
    localId: string
  ) => {
    setter((prev) => {
      const target = prev.pending.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return {
        ...prev,
        pending: prev.pending.filter((p) => p.localId !== localId),
      };
    });
  };

  const handleSaveOrSend = async (mode: 'BORRADOR' | 'ENVIAR') => {
    setErrorMsg('');
    const cleanActividades = actividades.map((a) => a.trim()).filter(Boolean);
    if (cleanActividades.length === 0) {
      setErrorMsg('Registra al menos una actividad realizada antes de guardar o enviar.');
      return;
    }
    if (!fechaCulminacion || !horaCulminacion) {
      setErrorMsg('Completa la fecha y hora de culminación.');
      return;
    }

    setSaving(true);
    try {
      const [upAct, upRec, upPen] = await Promise.all([
        uploadPrivateImages(
          imgActividades.pending.map((p) => p.file),
          'reporte',
          solicitud.id
        ),
        uploadPrivateImages(
          imgRecomendaciones.pending.map((p) => p.file),
          'reporte',
          solicitud.id
        ),
        uploadPrivateImages(
          imgPendientes.pending.map((p) => p.file),
          'reporte',
          solicitud.id
        ),
      ]);

      const finalAct = [...imgActividades.existing, ...upAct];
      const finalRec = [...imgRecomendaciones.existing, ...upRec];
      const finalPen = [...imgPendientes.existing, ...upPen];

      const res = await apiRequest<{
        reporte: Reporte;
        pdfGenerated: boolean;
        emailSent: boolean;
        emailDetail: string;
      }>(`/api/solicitudes/${solicitud.id}/reporte`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          actividades: cleanActividades,
          recomendaciones: recomendaciones.trim(),
          pendientes: pendientes.trim(),
          imagenes_actividades: finalAct.map((f) => f.id),
          imagenes_recomendaciones: finalRec.map((f) => f.id),
          imagenes_pendientes: finalPen.map((f) => f.id),
          fecha_culminacion: fechaCulminacion,
          hora_culminacion: horaCulminacion,
        }),
      });

      // Keep dialog open and refresh local sections with saved signed URLs!
      setImgActividades({ existing: res.reporte.imagenes_actividades, pending: [] });
      setImgRecomendaciones({ existing: res.reporte.imagenes_recomendaciones, pending: [] });
      setImgPendientes({ existing: res.reporte.imagenes_pendientes, pending: [] });

      if (mode === 'ENVIAR') {
        setResultBanner({
          type: 'sent',
          title: res.emailSent
            ? 'Reporte enviado y PDF adjunto por correo'
            : 'Reporte guardado y PDF generado en el servidor',
          detail: res.emailDetail,
          emailSent: res.emailSent,
          pdfGenerated: res.pdfGenerated,
        });
      } else {
        setResultBanner({
          type: 'draft',
          title: 'Borrador guardado',
          detail: 'Los cambios e imágenes por sección han sido guardados correctamente.',
        });
      }

      await onSaved(res.reporte);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo procesar el reporte.');
    } finally {
      setSaving(false);
    }
  };

  const renderImageZone = (
    title: string,
    state: SectionImagesState,
    setter: React.Dispatch<React.SetStateAction<SectionImagesState>>,
    inputId: string
  ) => {
    const count = state.existing.length + state.pending.length;
    return (
      <div className="mt-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{title}</span>
          <span className="text-xs font-mono text-slate-500">{count}/6</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
          {state.existing.map((img) => (
            <div
              key={img.id}
              className="relative aspect-square rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800"
            >
              <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeExistingFromSection(setter, img.id)}
                aria-label={`Quitar ${img.name}`}
                className="absolute top-1 right-1 min-h-[28px] min-w-[28px] rounded-md bg-black/70 text-white flex items-center justify-center hover:bg-red-700"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {state.pending.map((img) => (
            <div
              key={img.localId}
              className="relative aspect-square rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800"
            >
              <img src={img.previewUrl} alt={img.file.name} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removePendingFromSection(setter, img.localId)}
                aria-label={`Quitar ${img.file.name}`}
                className="absolute top-1 right-1 min-h-[28px] min-w-[28px] rounded-md bg-black/70 text-white flex items-center justify-center hover:bg-red-700"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {count < 6 && (
            <label
              htmlFor={inputId}
              className="aspect-square rounded-lg border border-dashed border-slate-300 dark:border-slate-700 hover:border-[#C8102E] flex flex-col items-center justify-center gap-1 text-slate-500 dark:text-slate-400 cursor-pointer p-1 text-center"
            >
              <ImagePlus className="w-4 h-4" />
              <span className="text-[11px]">Agregar</span>
              <input
                id={inputId}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  addPendingToSection(setter, e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reporte-dialog-title"
    >
      <div className="w-full max-w-4xl max-h-[94dvh] flex flex-col bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-[#C8102E] dark:text-red-400">
              <FileText className="w-3.5 h-3.5" />
              <span>{solicitud.codigo}</span>
              <span>·</span>
              <span>{solicitud.cliente}</span>
            </div>
            <h2
              id="reporte-dialog-title"
              className="font-heading text-lg font-bold text-slate-900 dark:text-white mt-0.5"
            >
              Reporte Técnico de Visita
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReviewMode((v) => !v)}
              className="min-h-[44px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Eye className="w-4 h-4" />
              <span>{reviewMode ? 'Editar reporte' : 'Revisar contenido'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar reporte"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5 space-y-6 flex-1">
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {resultBanner && (
            <div
              role="status"
              className={`p-4 rounded-xl border text-sm flex items-start gap-3 ${
                resultBanner.type === 'sent' && !resultBanner.emailSent
                  ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                  : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
              }`}
            >
              {resultBanner.type === 'sent' && !resultBanner.emailSent ? (
                <Mail className="w-5 h-5 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1">
                <p className="font-medium">{resultBanner.title}</p>
                <p className="text-xs sm:text-sm text-justify">{resultBanner.detail}</p>
                <p className="text-xs opacity-80">
                  Este diálogo permanece abierto para que verifiques el resultado antes de cerrar.
                </p>
              </div>
            </div>
          )}

          {reviewMode ? (
            <div className="space-y-5 border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-slate-50/70 dark:bg-slate-950/40">
              <div className="flex flex-wrap justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <p className="text-xs font-bold text-[#B91C1C]">CLIENTE / DISTRITO</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {solicitud.cliente} · {solicitud.distrito}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-[#B91C1C]">CULMINACIÓN</p>
                  <p className="text-sm font-mono text-slate-900 dark:text-white">
                    {fechaCulminacion} {horaCulminacion}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-[#B91C1C] mb-2">1. ACTIVIDADES REALIZADAS</h3>
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-slate-900 dark:text-slate-100 text-justify">
                  {actividades
                    .map((a) => a.trim())
                    .filter(Boolean)
                    .map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                </ol>
                {(imgActividades.existing.length > 0 || imgActividades.pending.length > 0) && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {imgActividades.existing.map((i) => (
                      <img key={i.id} src={i.url} alt={i.name} className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    ))}
                    {imgActividades.pending.map((i) => (
                      <img key={i.localId} src={i.previewUrl} alt={i.file.name} className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-[#B91C1C] mb-1.5">2. RECOMENDACIONES</h3>
                <p className="text-sm text-slate-900 dark:text-slate-100 text-justify whitespace-pre-line">
                  {recomendaciones.trim() || 'Sin recomendaciones adicionales registradas.'}
                </p>
                {(imgRecomendaciones.existing.length > 0 || imgRecomendaciones.pending.length > 0) && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {imgRecomendaciones.existing.map((i) => (
                      <img key={i.id} src={i.url} alt={i.name} className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    ))}
                    {imgRecomendaciones.pending.map((i) => (
                      <img key={i.localId} src={i.previewUrl} alt={i.file.name} className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-[#B91C1C] mb-1.5">3. PENDIENTES</h3>
                <p className="text-sm text-slate-900 dark:text-slate-100 text-justify whitespace-pre-line">
                  {pendientes.trim() || 'No se registran pendientes abiertos.'}
                </p>
                {(imgPendientes.existing.length > 0 || imgPendientes.pending.length > 0) && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {imgPendientes.existing.map((i) => (
                      <img key={i.id} src={i.url} alt={i.name} className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    ))}
                    {imgPendientes.pending.map((i) => (
                      <img key={i.localId} src={i.previewUrl} alt={i.file.name} className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="rep-fecha"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Fecha de culminación <span className="text-[#C8102E]">*</span>
                  </label>
                  <input
                    id="rep-fecha"
                    type="date"
                    required
                    value={fechaCulminacion}
                    onChange={(e) => setFechaCulminacion(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="rep-hora"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Hora de culminación <span className="text-[#C8102E]">*</span>
                  </label>
                  <input
                    id="rep-hora"
                    type="time"
                    required
                    value={horaCulminacion}
                    onChange={(e) => setHoraCulminacion(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Zona 1: Actividades */}
              <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-sm font-bold text-slate-900 dark:text-white">
                    1. Actividades realizadas <span className="text-[#C8102E]">*</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActividades((prev) => [...prev, ''])}
                    className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Agregar actividad
                  </button>
                </div>

                <div className="space-y-2">
                  {actividades.map((act, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="min-h-[44px] flex items-center text-xs font-mono text-slate-500 w-5 shrink-0">
                        {idx + 1}.
                      </span>
                      <input
                        type="text"
                        value={act}
                        onChange={(e) => {
                          const val = e.target.value;
                          setActividades((prev) => prev.map((item, i) => (i === idx ? val : item)));
                        }}
                        placeholder="Describe la actividad técnica ejecutada..."
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      />
                      {actividades.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setActividades((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label={`Quitar actividad ${idx + 1}`}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {renderImageZone(
                  'Fotos exclusivas de Actividades',
                  imgActividades,
                  setImgActividades,
                  'rep-img-act'
                )}
              </section>

              {/* Zona 2: Recomendaciones */}
              <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <label
                  htmlFor="rep-rec"
                  className="block font-heading text-sm font-bold text-slate-900 dark:text-white"
                >
                  2. Recomendaciones técnicas
                </label>
                <textarea
                  id="rep-rec"
                  rows={3}
                  value={recomendaciones}
                  onChange={(e) => setRecomendaciones(e.target.value)}
                  placeholder="Indicaciones técnicas, mejoras sugeridas o requerimientos para el cliente..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
                {renderImageZone(
                  'Fotos exclusivas de Recomendaciones',
                  imgRecomendaciones,
                  setImgRecomendaciones,
                  'rep-img-rec'
                )}
              </section>

              {/* Zona 3: Pendientes */}
              <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <label
                  htmlFor="rep-pen"
                  className="block font-heading text-sm font-bold text-slate-900 dark:text-white"
                >
                  3. Pendientes y próximos pasos
                </label>
                <textarea
                  id="rep-pen"
                  rows={3}
                  value={pendientes}
                  onChange={(e) => setPendientes(e.target.value)}
                  placeholder="Cotizaciones pendientes, repuestos por validar o segunda visita..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
                {renderImageZone(
                  'Fotos exclusivas de Pendientes',
                  imgPendientes,
                  setImgPendientes,
                  'rep-img-pen'
                )}
              </section>
            </>
          )}
        </div>

        {/* Footer (no auto-close, no manual PDF download per requirement) */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 shrink-0 safe-bottom">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Cerrar
          </button>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveOrSend('BORRADOR')}
              className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Procesando...' : 'Guardar borrador'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveOrSend('ENVIAR')}
              className="min-h-[44px] px-5 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{saving ? 'Generando PDF y enviando...' : 'Enviar reporte y PDF por correo'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
