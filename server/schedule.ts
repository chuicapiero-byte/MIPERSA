import { db } from './db.ts';

export function isValidDateYYYYMMDD(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTimeHHMM(hora: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(hora)) return false;
  const [h, m] = hora.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function parseTimeToMinutes(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getMargenMinutos(): number {
  const row = db.prepare('SELECT margen_minutos FROM configuracion WHERE id = 1').get() as
    | { margen_minutos: number }
    | undefined;
  return row && Number.isFinite(row.margen_minutos) && row.margen_minutos >= 0 ? row.margen_minutos : 60;
}

export interface ConflictResult {
  available: boolean;
  reason?: string;
  conflictType?: 'BLOQUEO' | 'CRUCE_ACEPTADA';
  blockingDetails?: {
    codigo?: string;
    cliente?: string;
    horario?: string;
    motivo?: string;
    margenMinutos?: number;
  };
}

export function checkTechnicianAvailability(params: {
  tecnicoId: string;
  fecha: string;
  horaSalida: string;
  horaRetorno: string;
  excludeSolicitudId?: string;
}): ConflictResult {
  const { tecnicoId, fecha, horaSalida, horaRetorno, excludeSolicitudId } = params;
  const margen = getMargenMinutos();

  // 1. Verificar bloqueo del día
  const bloqueo = db
    .prepare('SELECT id, motivo FROM bloqueos WHERE tecnico_id = ? AND fecha = ?')
    .get(tecnicoId, fecha) as { id: string; motivo: string } | undefined;

  if (bloqueo) {
    return {
      available: false,
      conflictType: 'BLOQUEO',
      reason: `El técnico tiene bloqueada la fecha ${fecha}. Motivo: ${bloqueo.motivo}`,
      blockingDetails: {
        motivo: bloqueo.motivo,
      },
    };
  }

  // 2. Verificar cruce con visitas ACEPTADAS usando el margen de traslado
  const reqStart = parseTimeToMinutes(horaSalida);
  const reqEnd = parseTimeToMinutes(horaRetorno);

  const acceptedRows = db
    .prepare(
      `SELECT id, codigo, cliente, hora_salida, hora_retorno
       FROM solicitudes
       WHERE tecnico_id = ? AND fecha = ? AND estado = 'ACEPTADA'`
    )
    .all(tecnicoId, fecha) as Array<{
    id: string;
    codigo: string;
    cliente: string;
    hora_salida: string;
    hora_retorno: string;
  }>;

  for (const row of acceptedRows) {
    if (excludeSolicitudId && row.id === excludeSolicitudId) continue;
    const existStart = parseTimeToMinutes(row.hora_salida);
    const existEnd = parseTimeToMinutes(row.hora_retorno);

    // Intervalo ocupado: [existStart - margen, existEnd + margen]
    const occupiedStart = existStart - margen;
    const occupiedEnd = existEnd + margen;

    if (reqStart < occupiedEnd && reqEnd > occupiedStart) {
      const safeBefore = formatMinutesToHHMM(Math.max(0, occupiedStart));
      const safeAfter = formatMinutesToHHMM(Math.min(23 * 60 + 59, occupiedEnd));
      return {
        available: false,
        conflictType: 'CRUCE_ACEPTADA',
        reason: `Cruce de agenda con la visita aceptada ${row.codigo} (${row.cliente}, ${row.hora_salida}–${row.hora_retorno}). Con el margen de traslado de ${margen} min, el técnico está ocupado de ${safeBefore} a ${safeAfter}.`,
        blockingDetails: {
          codigo: row.codigo,
          cliente: row.cliente,
          horario: `${row.hora_salida} - ${row.hora_retorno}`,
          margenMinutos: margen,
        },
      };
    }
  }

  return { available: true };
}

export function findConflictingPendingSolicitudes(params: {
  tecnicoId: string;
  fecha: string;
  horaSalida: string;
  horaRetorno: string;
  acceptedSolicitudId: string;
}): Array<{
  id: string;
  codigo: string;
  cliente: string;
  ejecutivo_email: string;
  ejecutivo_nombre: string;
  hora_salida: string;
  hora_retorno: string;
}> {
  const { tecnicoId, fecha, horaSalida, horaRetorno, acceptedSolicitudId } = params;
  const margen = getMargenMinutos();
  const accStart = parseTimeToMinutes(horaSalida);
  const accEnd = parseTimeToMinutes(horaRetorno);
  const occupiedStart = accStart - margen;
  const occupiedEnd = accEnd + margen;

  const pendingRows = db
    .prepare(
      `SELECT id, codigo, cliente, ejecutivo_email, ejecutivo_nombre, hora_salida, hora_retorno
       FROM solicitudes
       WHERE tecnico_id = ? AND fecha = ? AND estado = 'PENDIENTE' AND id != ?`
    )
    .all(tecnicoId, fecha, acceptedSolicitudId) as Array<{
    id: string;
    codigo: string;
    cliente: string;
    ejecutivo_email: string;
    ejecutivo_nombre: string;
    hora_salida: string;
    hora_retorno: string;
  }>;

  return pendingRows.filter((row) => {
    const pStart = parseTimeToMinutes(row.hora_salida);
    const pEnd = parseTimeToMinutes(row.hora_retorno);
    return pStart < occupiedEnd && pEnd > occupiedStart;
  });
}

export function generateNextSolicitudCode(): string {
  const rows = db.prepare('SELECT codigo FROM solicitudes').all() as Array<{ codigo: string }>;
  let maxNum = 0;
  for (const r of rows) {
    const match = /^VIS-(\d+)$/i.exec(r.codigo || '');
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `VIS-${String(maxNum + 1).padStart(4, '0')}`;
}
