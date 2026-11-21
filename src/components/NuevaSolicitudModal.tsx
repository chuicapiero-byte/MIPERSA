import { AlertTriangle, CheckCircle2, ImagePlus, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, uploadPrivateImages } from '../lib/api.ts';
import type {
  ClienteItem,
  DistritoItem,
  MotivoVisita,
  Perfil,
  Solicitud,
} from '../types.ts';
import { AutocompleteInput } from './AutocompleteInput.tsx';

const MOTIVOS: MotivoVisita[] = [
  'Levantamiento técnico',
  'Demostración de equipo',
  'Mantenimiento / Garantía',
  'Capacitación',
  'Otro',
];

interface PendingLocalImage {
  localId: string;
  file: File;
  previewUrl: string;
}

interface NuevaSolicitudModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (solicitud: Solicitud, whatsappTecnicoUrl?: string | null) => Promise<void> | void;
  currentProfile: Perfil;
  clientes: ClienteItem[];
  distritos: DistritoItem[];
  tecnicos: Perfil[];
  ejecutivos: Perfil[];
  margenMinutos: number;
  initialFecha?: string | null;
  initialTecnicoId?: string | null;
}

export function NuevaSolicitudModal({
  open,
  onClose,
  onCreated,
  currentProfile,
  clientes,
  distritos,
  tecnicos,
  ejecutivos,
  margenMinutos,
  initialFecha,
  initialTecnicoId,
}: NuevaSolicitudModalProps) {
  const todayISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const [ejecutivoEmail, setEjecutivoEmail] = useState(currentProfile.email);
  const [usarCarteraGeneral, setUsarCarteraGeneral] = useState(currentProfile.rol === 'admin');
  const [cliente, setCliente] = useState('');
  const [distrito, setDistrito] = useState('');
  const [fecha, setFecha] = useState(todayISO);
  const [horaSalida, setHoraSalida] = useState('09:00');
  const [horaRetorno, setHoraRetorno] = useState('11:00');
  const [motivo, setMotivo] = useState<string>(MOTIVOS[0]);
  const [motivoOtro, setMotivoOtro] = useState('');
  const [tecnicoId, setTecnicoId] = useState(tecnicos[0]?.id || '');
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoCargo, setContactoCargo] = useState('');
  const [contactoCelular, setContactoCelular] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [localImages, setLocalImages] = useState<PendingLocalImage[]>([]);

  const [availStatus, setAvailStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    reason?: string;
  }>({ checking: false, available: null });

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (open) {
      setErrorMsg('');
      setFecha(initialFecha || todayISO);
      setTecnicoId(initialTecnicoId || tecnicos[0]?.id || '');
    }
  }, [open, initialFecha, initialTecnicoId, todayISO, tecnicos]);

  useEffect(() => {
    return () => {
      for (const item of localImages) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, [localImages]);

  // Filtrar cartera según rol y ejecutivo seleccionado
  const availableClients = useMemo(() => {
    if (currentProfile.rol === 'vendedor') {
      return clientes;
    }
    if (currentProfile.rol === 'admin' && usarCarteraGeneral) {
      return clientes;
    }
    const exec =
      ejecutivos.find((e) => e.email.toLowerCase() === ejecutivoEmail.toLowerCase()) ||
      currentProfile;
    if (exec.rol === 'admin') {
      return clientes;
    }
    return clientes.filter((c) => exec.cartera_clientes.includes(c.nombre));
  }, [clientes, currentProfile, ejecutivos, ejecutivoEmail, usarCarteraGeneral]);

  const clientOptions = useMemo(
    () =>
      availableClients.map((c) => ({
        value: c.nombre,
        subtitle: [c.sector, c.ruc ? `RUC ${c.ruc}` : ''].filter(Boolean).join(' · '),
      })),
    [availableClients]
  );

  const districtOptions = useMemo(
    () =>
      distritos.map((d) => ({
        value: d.nombre,
        subtitle: `${d.provincia}, ${d.departamento}`,
      })),
    [distritos]
  );

  // Verificación dinámica de disponibilidad en servidor
  useEffect(() => {
    if (!open || !tecnicoId || !fecha || !horaSalida || !horaRetorno) {
      setAvailStatus({ checking: false, available: null });
      return;
    }
    if (horaRetorno <= horaSalida) {
      setAvailStatus({
        checking: false,
        available: false,
        reason: 'La hora de retorno debe ser posterior a la hora de salida.',
      });
      return;
    }

    let cancelled = false;
    setAvailStatus({ checking: true, available: null });
    const timer = setTimeout(() => {
      apiRequest<{ available: boolean; reason?: string }>('/api/solicitudes/check-availability', {
        method: 'POST',
        body: JSON.stringify({
          tecnico_id: tecnicoId,
          fecha,
          hora_salida: horaSalida,
          hora_retorno: horaRetorno,
        }),
      })
        .then((res) => {
          if (!cancelled) {
            setAvailStatus({
              checking: false,
              available: res.available,
              reason: res.reason,
            });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAvailStatus({ checking: false, available: null });
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, tecnicoId, fecha, horaSalida, horaRetorno]);

  if (!open) return null;

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const remaining = 5 - localImages.length;
    if (remaining <= 0) {
      setErrorMsg('Solo se permiten hasta 5 imágenes de referencia por solicitud.');
      return;
    }
    const toAdd = files.slice(0, remaining).map((file) => ({
      localId: `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setLocalImages((prev) => [...prev, ...toAdd]);
  };

  const removeLocalImage = (localId: string) => {
    setLocalImages((prev) => {
      const target = prev.find((i) => i.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.localId !== localId);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!cliente) {
      setErrorMsg('Selecciona un cliente oficial desde las sugerencias.');
      return;
    }
    if (!distrito) {
      setErrorMsg('Selecciona un distrito oficial desde las sugerencias.');
      return;
    }
    if (horaRetorno <= horaSalida) {
      setErrorMsg('La hora de retorno debe ser posterior a la hora de salida.');
      return;
    }
    if (motivo === 'Otro' && !motivoOtro.trim()) {
      setErrorMsg('Especifica el motivo adicional cuando seleccionas "Otro".');
      return;
    }
    if (availStatus.available === false) {
      setErrorMsg(availStatus.reason || 'El técnico no está disponible en el horario indicado.');
      return;
    }

    setSubmitting(true);
    try {
      const uploadedRefs =
        localImages.length > 0
          ? await uploadPrivateImages(
              localImages.map((i) => i.file),
              'solicitud'
            )
          : [];

      const res = await apiRequest<{ solicitud: Solicitud; whatsappTecnicoUrl?: string | null }>(
        '/api/solicitudes',
        {
          method: 'POST',
          body: JSON.stringify({
            ejecutivo_email: currentProfile.rol === 'admin' ? ejecutivoEmail : currentProfile.email,
            usar_cartera_general: currentProfile.rol === 'admin' ? usarCarteraGeneral : false,
            cliente,
            distrito,
            fecha,
            hora_salida: horaSalida,
            hora_retorno: horaRetorno,
            motivo,
            motivo_otro: motivo === 'Otro' ? motivoOtro.trim() : '',
            tecnico_id: tecnicoId,
            contacto_nombre: contactoNombre.trim(),
            contacto_cargo: contactoCargo.trim(),
            contacto_celular: contactoCelular.trim(),
            descripcion: descripcion.trim(),
            imagenes: uploadedRefs.map((f) => f.id),
          }),
        }
      );

      // Reset form cleanly
      setCliente('');
      setDistrito('');
      setMotivoOtro('');
      setContactoNombre('');
      setContactoCargo('');
      setContactoCelular('');
      setDescripcion('');
      setLocalImages([]);

      await onCreated(res.solicitud, res.whatsappTecnicoUrl);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo registrar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nueva-solicitud-title"
    >
      <div className="w-full max-w-3xl max-h-[94dvh] flex flex-col bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div>
            <h2
              id="nueva-solicitud-title"
              className="font-heading text-lg font-bold text-slate-900 dark:text-white"
            >
              Nueva solicitud de visita técnica
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Margen de traslado configurado: {margenMinutos} minutos entre visitas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar formulario"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {currentProfile.rol === 'admin' && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label
                    htmlFor="sol-exec"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Ejecutivo comercial solicitante
                  </label>
                  <select
                    id="sol-exec"
                    value={ejecutivoEmail}
                    onChange={(e) => {
                      setEjecutivoEmail(e.target.value);
                      setCliente('');
                    }}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    {ejecutivos.map((ex) => (
                      <option key={ex.id} value={ex.email}>
                        {ex.nombre} ({ex.rol === 'admin' ? 'Admin' : 'Ejecutivo'})
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={usarCarteraGeneral}
                    onChange={(e) => setUsarCarteraGeneral(e.target.checked)}
                    className="w-4 h-4 accent-[#C8102E]"
                  />
                  <span>Seleccionar de la cartera general MIPERSA</span>
                </label>
              </div>
            </div>
          )}

          {currentProfile.rol === 'vendedor' && clientes.length === 0 && (
            <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
              Tu perfil aún no tiene clientes asignados en cartera. Solicita al Administrador la asignación desde Configuración &gt; Carteras de ejecutivos.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AutocompleteInput
              id="sol-cliente"
              label="Cliente"
              placeholder="Escribe para buscar cliente oficial..."
              value={cliente}
              options={clientOptions}
              onChange={setCliente}
              emptyMessage={
                availableClients.length === 0
                  ? 'No hay clientes asignados en la cartera seleccionada.'
                  : 'No hay clientes coincidentes en la cartera.'
              }
              required
            />

            <AutocompleteInput
              id="sol-distrito"
              label="Distrito"
              placeholder="Buscar distrito oficial..."
              value={distrito}
              options={districtOptions}
              onChange={setDistrito}
              emptyMessage="No se encontró ningún distrito oficial con ese nombre."
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="sol-fecha"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Fecha de visita <span className="text-[#C8102E]">*</span>
              </label>
              <input
                id="sol-fecha"
                type="date"
                required
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sol-salida"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Hora de salida <span className="text-[#C8102E]">*</span>
              </label>
              <input
                id="sol-salida"
                type="time"
                required
                value={horaSalida}
                onChange={(e) => setHoraSalida(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sol-retorno"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Hora de retorno <span className="text-[#C8102E]">*</span>
              </label>
              <input
                id="sol-retorno"
                type="time"
                required
                value={horaRetorno}
                onChange={(e) => setHoraRetorno(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="sol-tecnico"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Asesor técnico asignado <span className="text-[#C8102E]">*</span>
              </label>
              <select
                id="sol-tecnico"
                required
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                {tecnicos.length === 0 ? (
                  <option value="">Sin técnicos activos disponibles</option>
                ) : (
                  tecnicos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre} — {t.especialidad || 'Soporte Técnico'}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="sol-motivo"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Motivo de la visita <span className="text-[#C8102E]">*</span>
              </label>
              <select
                id="sol-motivo"
                required
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                {MOTIVOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Live Server Availability Feedback */}
          {availStatus.checking ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verificando disponibilidad, bloqueos y margen de traslado del técnico...
            </p>
          ) : availStatus.available === true ? (
            <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Horario disponible. No se detectan bloqueos ni cruces con visitas aceptadas.</span>
            </div>
          ) : availStatus.available === false ? (
            <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">No es posible programar en esta fecha u horario</p>
                <p className="mt-0.5 text-xs sm:text-sm">{availStatus.reason}</p>
              </div>
            </div>
          ) : null}

          {motivo === 'Otro' && (
            <div>
              <label
                htmlFor="sol-motivo-otro"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Detalle del motivo ("Otro") <span className="text-[#C8102E]">*</span>
              </label>
              <input
                id="sol-motivo-otro"
                type="text"
                required
                value={motivoOtro}
                onChange={(e) => setMotivoOtro(e.target.value)}
                placeholder="Describe brevemente el objetivo de la visita..."
                className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="sol-contacto-nombre"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Nombre del contacto <span className="text-[#C8102E]">*</span>
              </label>
              <input
                id="sol-contacto-nombre"
                type="text"
                required
                value={contactoNombre}
                onChange={(e) => setContactoNombre(e.target.value)}
                placeholder="Ej. Ing. Marcos Delgado"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label
                htmlFor="sol-contacto-cargo"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Cargo <span className="text-[#C8102E]">*</span>
              </label>
              <input
                id="sol-contacto-cargo"
                type="text"
                required
                value={contactoCargo}
                onChange={(e) => setContactoCargo(e.target.value)}
                placeholder="Ej. Jefe de Planta"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label
                htmlFor="sol-contacto-cel"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Celular del contacto <span className="text-[#C8102E]">*</span>
              </label>
              <input
                id="sol-contacto-cel"
                type="tel"
                required
                value={contactoCelular}
                onChange={(e) => setContactoCelular(e.target.value)}
                placeholder="987654321"
                className="w-full min-h-[44px] px-3.5 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="sol-desc"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Descripción y alcance técnico requerido <span className="text-[#C8102E]">*</span>
            </label>
            <textarea
              id="sol-desc"
              rows={3}
              required
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Detalla los equipos, área de planta, requerimientos de EPP o documentación..."
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Imágenes de referencia (máximo 5) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Imágenes de referencia (opcional, máx. 5)
              </span>
              <span className="text-xs font-mono text-slate-500">
                {localImages.length}/5 adjuntas
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {localImages.map((img) => (
                <div
                  key={img.localId}
                  className="relative aspect-square rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800"
                >
                  <img
                    src={img.previewUrl}
                    alt={img.file.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeLocalImage(img.localId)}
                    aria-label={`Quitar ${img.file.name}`}
                    className="absolute top-1.5 right-1.5 min-h-[32px] min-w-[32px] rounded-lg bg-black/70 text-white flex items-center justify-center hover:bg-red-700 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {localImages.length < 5 && (
                <label className="aspect-square rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-[#C8102E] flex flex-col items-center justify-center gap-1.5 text-slate-500 dark:text-slate-400 cursor-pointer transition-colors p-2 text-center">
                  <ImagePlus className="w-5 h-5" />
                  <span className="text-xs">Adjuntar foto</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFilesSelected}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Footer actions inside form */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 safe-bottom">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || availStatus.available === false || tecnicos.length === 0}
              className="min-h-[44px] px-5 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? 'Registrando solicitud...' : 'Registrar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
