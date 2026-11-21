import { CheckCircle2, Clock, Lock, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { SolicitudEstado } from '../types.ts';

export const MIPERSA_LOGO_URL = '/assets/aistudio/image_57729cb3.png';

export function MipersaWordmark({
  compact = false,
  boxed = false,
}: {
  compact?: boolean;
  boxed?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (boxed) {
    return (
      <div className="bg-white rounded-2xl h-[92px] px-3 flex items-center justify-center shadow-xs w-full overflow-hidden">
        {!imgFailed ? (
          <img
            src={MIPERSA_LOGO_URL}
            alt="MIPERSA"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-[210px] max-w-none h-auto shrink-0 select-none pointer-events-none"
          />
        ) : (
          <span className="font-heading font-bold text-3xl tracking-tight text-[#E10600]">
            mipersa
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
      {!imgFailed ? (
        <div
          className={`bg-white rounded-xl border border-slate-200/80 dark:border-slate-700 flex items-center justify-center shrink-0 overflow-hidden ${
            compact ? 'h-10 px-2' : 'h-11 px-2.5'
          }`}
        >
          <img
            src={MIPERSA_LOGO_URL}
            alt="MIPERSA"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`${
              compact ? 'w-[116px]' : 'w-[144px]'
            } max-w-none h-auto shrink-0 select-none pointer-events-none`}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg bg-[#E10600] text-white flex items-center justify-center font-heading font-bold text-base tracking-tight shrink-0"
            aria-hidden="true"
          >
            M
          </div>
          {!compact && (
            <span className="font-heading font-bold text-base tracking-tight text-slate-900 dark:text-slate-100">
              MIPERSA
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function EstadoTexto({ estado }: { estado: SolicitudEstado | 'BLOQUEADO' }) {
  if (estado === 'ACEPTADA') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Aceptada
      </span>
    );
  }
  if (estado === 'RECHAZADA') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Rechazada
      </span>
    );
  }
  if (estado === 'BLOQUEADO') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
        <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Bloqueado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      Pendiente
    </span>
  );
}

export function RolLabel({ rol }: { rol: 'admin' | 'vendedor' | 'tecnico' }) {
  const labels = {
    admin: 'Administrador',
    vendedor: 'Ejecutivo de ventas',
    tecnico: 'Asesor técnico',
  };
  return <span>{labels[rol]}</span>;
}
