import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { UPLOAD_DIR, db } from './db.ts';
import { isSmtpConfigured, sendCorporateEmail } from './mailer.ts';
import { generateVisitReportPdf } from './pdf.ts';
import {
  checkTechnicianAvailability,
  findConflictingPendingSolicitudes,
  generateNextSolicitudCode,
  isValidDateYYYYMMDD,
  isValidTimeHHMM,
  parseTimeToMinutes,
} from './schedule.ts';
import {
  buildTotpUri,
  generateRandomToken,
  generateTotpSecret,
  hashPassword,
  hashToken,
  isSafeReturnTo,
  isValidEmail,
  isValidMipersaEmail,
  normalizeCorporateEmail,
  resolveSafeUploadPath,
  signFileUrl,
  signQuickActionToken,
  signSessionToken,
  verifyFileSignature,
  verifyPassword,
  verifyQuickActionToken,
  verifySessionToken,
  verifyTotpCode,
} from './security.ts';
import type { FileRef, Perfil, Solicitud, UserRole } from '../src/types.ts';

const SESSION_COOKIE = 'mipersa_session';
const SESSION_TTL = 60 * 60 * 12; // 12 hours

interface AuthContext {
  userId: string;
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  profile: Perfil | null;
}

declare global {
  namespace Express {
    interface Request {
      authCtx?: AuthContext;
    }
  }
}

function getCookieOptions(req: Request, maxAgeMs?: number): express.CookieOptions {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (typeof req.headers.origin === 'string' && req.headers.origin.startsWith('https://'));

  const opts: express.CookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  };
  if (isHttps) {
    (opts as express.CookieOptions & { partitioned?: boolean }).partitioned = true;
  }
  if (typeof maxAgeMs === 'number') {
    opts.maxAge = maxAgeMs;
  }
  return opts;
}

function parseProfileRow(row: Record<string, unknown>): Perfil {
  let cartera: string[] = [];
  try {
    cartera = JSON.parse(String(row.cartera_clientes || '[]'));
    if (!Array.isArray(cartera)) cartera = [];
  } catch {
    cartera = [];
  }
  return {
    id: String(row.id),
    email: String(row.email),
    nombre: String(row.nombre),
    rol: String(row.rol) as UserRole,
    celular: String(row.celular || ''),
    especialidad: String(row.especialidad || ''),
    activo: Number(row.activo) === 1,
    cartera_clientes: cartera,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function hydrateFileRefs(rawJson: string): FileRef[] {
  let arr: Array<{ id: string; name: string; mimeType: string }> = [];
  try {
    arr = JSON.parse(rawJson || '[]');
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  return arr
    .filter((f) => f && typeof f.id === 'string')
    .map((f) => ({
      id: f.id,
      name: f.name || 'archivo.jpg',
      mimeType: f.mimeType || 'image/jpeg',
      url: signFileUrl(f.id, 900),
    }));
}

function parseSolicitudRow(row: Record<string, unknown>): Solicitud {
  const reporteRow = db
    .prepare('SELECT estado_envio FROM reportes WHERE solicitud_id = ?')
    .get(String(row.id)) as { estado_envio: 'BORRADOR' | 'ENVIADO' } | undefined;

  return {
    id: String(row.id),
    codigo: String(row.codigo),
    ejecutivo_email: String(row.ejecutivo_email),
    ejecutivo_nombre: String(row.ejecutivo_nombre),
    cliente: String(row.cliente),
    distrito: String(row.distrito),
    fecha: String(row.fecha),
    hora_salida: String(row.hora_salida),
    hora_retorno: String(row.hora_retorno),
    motivo: String(row.motivo),
    motivo_otro: String(row.motivo_otro || ''),
    tecnico_id: String(row.tecnico_id),
    tecnico_nombre: String(row.tecnico_nombre),
    contacto_nombre: String(row.contacto_nombre),
    contacto_cargo: String(row.contacto_cargo),
    contacto_celular: String(row.contacto_celular),
    descripcion: String(row.descripcion),
    imagenes: hydrateFileRefs(String(row.imagenes || '[]')),
    estado: String(row.estado) as Solicitud['estado'],
    respondido_por: row.respondido_por ? String(row.respondido_por) : null,
    fecha_respuesta: row.fecha_respuesta ? String(row.fecha_respuesta) : null,
    observacion: String(row.observacion || ''),
    tiene_reporte: Boolean(reporteRow),
    reporte_estado: reporteRow ? reporteRow.estado_envio : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function buildWhatsAppUrl(phoneRaw: string, text: string): string | null {
  const digits = (phoneRaw || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  const normalized = digits.startsWith('51') ? digits : digits.length === 9 ? `51${digits}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

function getRequestBaseUrl(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('host') || 'localhost:3000';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function needsInitialAdminSetup(): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c
       FROM users u
       JOIN profiles p ON LOWER(u.email) = LOWER(p.email)
       WHERE p.rol = 'admin' AND p.activo = 1`
    )
    .get() as { c: number };
  return row.c === 0;
}

function getAuthContextFromRequest(req: Request): AuthContext | null {
  let token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const authHeader = req.headers.authorization;
  if (!token && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token) return null;

  const payload = verifySessionToken(token, 'session');
  if (!payload) return null;

  const userRow = db
    .prepare('SELECT id, email, email_verified, mfa_enabled FROM users WHERE id = ?')
    .get(payload.uid) as
    | { id: string; email: string; email_verified: number; mfa_enabled: number }
    | undefined;
  if (!userRow) return null;

  const profileRow = db
    .prepare('SELECT * FROM profiles WHERE LOWER(email) = LOWER(?)')
    .get(userRow.email) as Record<string, unknown> | undefined;

  return {
    userId: userRow.id,
    email: userRow.email,
    emailVerified: userRow.email_verified === 1,
    mfaEnabled: userRow.mfa_enabled === 1,
    profile: profileRow ? parseProfileRow(profileRow) : null,
  };
}

function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const xrw = req.headers['x-requested-with'];
  if (xrw !== 'MIPERSA-SPA') {
    res.status(403).json({ error: 'Encabezado de seguridad inválido.' });
    return;
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const ctx = getAuthContextFromRequest(req);
  if (!ctx) {
    res.status(401).json({ error: 'Sesión no iniciada o expirada.' });
    return;
  }
  req.authCtx = ctx;
  next();
}

function requireActiveProfile(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const ctx = req.authCtx!;
    if (!ctx.profile) {
      res.status(403).json({
        error: 'Tu cuenta aún no tiene un perfil habilitado en MIPERSA.',
        code: 'PROFILE_NOT_ENABLED',
      });
      return;
    }
    if (!ctx.profile.activo) {
      res.status(403).json({
        error: 'Tu perfil corporativo se encuentra desactivado. Contacta al Administrador.',
        code: 'PROFILE_DISABLED',
      });
      return;
    }
    next();
  });
}

function requireRoles(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireActiveProfile(req, res, () => {
      const role = req.authCtx!.profile!.rol;
      if (!roles.includes(role)) {
        res.status(403).json({ error: 'No tienes permisos suficientes para realizar esta acción.' });
        return;
      }
      next();
    });
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 5 },
});

function detectImageMime(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

function normalizeCatalogKey(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function canAccessSolicitud(profile: Perfil, solicitud: { tecnico_id: string; ejecutivo_email: string }): boolean {
  if (profile.rol === 'admin' || profile.rol === 'vendedor') return true;
  return profile.rol === 'tecnico' && solicitud.tecnico_id === profile.id;
}

function validateImageIdList(raw: unknown, maxCount: number): Array<{ id: string; name: string; mimeType: string }> {
  if (!Array.isArray(raw)) return [];
  const trimmed = raw.slice(0, maxCount);
  const valid: Array<{ id: string; name: string; mimeType: string }> = [];
  for (const item of trimmed) {
    const id = typeof item === 'string' ? item : item && typeof item === 'object' && 'id' in item ? String((item as { id: unknown }).id) : '';
    if (!id) continue;
    const row = db
      .prepare('SELECT id, original_name, mime_type FROM archivos WHERE id = ?')
      .get(id) as { id: string; original_name: string; mime_type: string } | undefined;
    if (row) {
      valid.push({ id: row.id, name: row.original_name, mimeType: row.mime_type });
    }
  }
  return valid;
}

function safeUnlinkPrivateFile(fileId: string): void {
  const row = db.prepare('SELECT storage_name FROM archivos WHERE id = ?').get(fileId) as
    | { storage_name: string }
    | undefined;
  if (!row) return;
  try {
    const fp = resolveSafeUploadPath(UPLOAD_DIR, row.storage_name);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {
    // ignore unlink failure
  }
  db.prepare('DELETE FROM archivos WHERE id = ?').run(fileId);
}

interface AutoRejectedInfo {
  id: string;
  codigo: string;
  ejecutivo_email: string;
  ejecutivo_nombre: string;
  cliente: string;
  horario: string;
  whatsappUrl: string | null;
}

async function executeSolicitudResponse(params: {
  sol: Solicitud;
  actorEmail: string;
  actorNombre: string;
  accion: 'ACEPTAR' | 'RECHAZAR';
  observacion: string;
}): Promise<{
  solicitud: Solicitud;
  autoRejectedCount: number;
  autoRejected: AutoRejectedInfo[];
  whatsappVendedorUrl: string | null;
  whatsappAutoRejectedUrls: Array<{ codigo: string; url: string | null }>;
}> {
  const { sol, actorEmail, actorNombre, accion, observacion } = params;
  const now = new Date().toISOString();
  const autoRejected: AutoRejectedInfo[] = [];
  let whatsappVendedorUrl: string | null = null;

  if (accion === 'ACEPTAR') {
    const tx = db.transaction(() => {
      const avail = checkTechnicianAvailability({
        tecnicoId: sol.tecnico_id,
        fecha: sol.fecha,
        horaSalida: sol.hora_salida,
        horaRetorno: sol.hora_retorno,
        excludeSolicitudId: sol.id,
      });
      if (!avail.available) {
        throw Object.assign(new Error(avail.reason || 'Conflicto de agenda al aceptar.'), {
          statusCode: 409,
        });
      }

      db.prepare(
        `UPDATE solicitudes
         SET estado = 'ACEPTADA', respondido_por = ?, fecha_respuesta = ?, observacion = ?, updated_at = ?
         WHERE id = ? AND estado = 'PENDIENTE'`
      ).run(actorEmail, now, observacion, now, sol.id);

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, ?, ?, ?, ?, 'ACEPTACION', 'PENDIENTE', 'ACEPTADA', ?, ?)`
      ).run(
        crypto.randomUUID(),
        sol.id,
        sol.codigo,
        actorEmail,
        actorNombre,
        observacion || 'Visita aceptada y confirmada en agenda.',
        now
      );

      const execProfile = db
        .prepare('SELECT celular FROM profiles WHERE LOWER(email) = LOWER(?)')
        .get(sol.ejecutivo_email) as { celular: string } | undefined;

      whatsappVendedorUrl = execProfile
        ? buildWhatsAppUrl(
            execProfile.celular,
            `Hola ${sol.ejecutivo_nombre}, tu solicitud ${sol.codigo} para ${sol.cliente} (${sol.fecha} de ${sol.hora_salida} a ${sol.hora_retorno}) fue ACEPTADA por ${actorNombre}.${observacion ? ` Observación: ${observacion}` : ''}`
          )
        : null;

      db.prepare(
        `INSERT INTO notificaciones (id, destinatario_email, titulo, mensaje, tipo, solicitud_codigo, leida, whatsapp_url, created_at)
         VALUES (?, ?, ?, ?, 'respuesta', ?, 0, ?, ?)`
      ).run(
        crypto.randomUUID(),
        sol.ejecutivo_email,
        `Solicitud aceptada: ${sol.codigo}`,
        `${actorNombre} aceptó la visita a ${sol.cliente} para el ${sol.fecha} (${sol.hora_salida}–${sol.hora_retorno}).${observacion ? ` Observación: ${observacion}` : ''}`,
        sol.codigo,
        whatsappVendedorUrl,
        now
      );

      const conflicts = findConflictingPendingSolicitudes({
        tecnicoId: sol.tecnico_id,
        fecha: sol.fecha,
        horaSalida: sol.hora_salida,
        horaRetorno: sol.hora_retorno,
        acceptedSolicitudId: sol.id,
      });

      for (const c of conflicts) {
        const autoMotivo = `Rechazada automáticamente: El asesor aceptó otra visita prioritaria en este bloque horario (${sol.codigo}, ${sol.hora_salida}–${sol.hora_retorno}).`;
        db.prepare(
          `UPDATE solicitudes
           SET estado = 'RECHAZADA', respondido_por = 'sistema@mipersa.pe', fecha_respuesta = ?, observacion = ?, updated_at = ?
           WHERE id = ? AND estado = 'PENDIENTE'`
        ).run(now, autoMotivo, now, c.id);

        db.prepare(
          `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
           VALUES (?, ?, ?, 'sistema@mipersa.pe', 'Sistema MIPERSA', 'RECHAZO_AUTOMATICO', 'PENDIENTE', 'RECHAZADA', ?, ?)`
        ).run(crypto.randomUUID(), c.id, c.codigo, autoMotivo, now);

        const conflictVendorProfile = db
          .prepare('SELECT celular FROM profiles WHERE LOWER(email) = LOWER(?)')
          .get(c.ejecutivo_email) as { celular: string } | undefined;

        const waAutoReject = conflictVendorProfile
          ? buildWhatsAppUrl(
              conflictVendorProfile.celular,
              `Hola ${c.ejecutivo_nombre}, tu solicitud ${c.codigo} para ${c.cliente} (${sol.fecha} ${c.hora_salida}-${c.hora_retorno}) fue RECHAZADA AUTOMÁTICAMENTE porque el asesor ${sol.tecnico_nombre} aceptó otra visita prioritaria (${sol.codigo}).`
            )
          : null;

        db.prepare(
          `INSERT INTO notificaciones (id, destinatario_email, titulo, mensaje, tipo, solicitud_codigo, leida, whatsapp_url, created_at)
           VALUES (?, ?, ?, ?, 'rechazo_auto', ?, 0, ?, ?)`
        ).run(
          crypto.randomUUID(),
          c.ejecutivo_email,
          `Rechazo automático por cruce: ${c.codigo}`,
          autoMotivo,
          c.codigo,
          waAutoReject,
          now
        );

        autoRejected.push({
          id: c.id,
          codigo: c.codigo,
          ejecutivo_email: c.ejecutivo_email,
          ejecutivo_nombre: c.ejecutivo_nombre,
          cliente: c.cliente,
          horario: `${c.hora_salida}-${c.hora_retorno}`,
          whatsappUrl: waAutoReject,
        });
      }
    });
    tx();

    if (isSmtpConfigured()) {
      await sendCorporateEmail({
        to: [sol.ejecutivo_email],
        subject: `Visita ACEPTADA: ${sol.codigo} — ${sol.cliente}`,
        text: `Hola ${sol.ejecutivo_nombre},\n\nTu solicitud ${sol.codigo} para ${sol.cliente} (${sol.fecha} ${sol.hora_salida}-${sol.hora_retorno}) fue ACEPTADA por ${actorNombre}.\nObservación: ${observacion || 'Sin observación adicional.'}`,
        html: `<div style="font-family:Roboto,Arial,sans-serif;color:#0f172a;max-width:600px"><h2 style="color:#047857;margin-bottom:8px">Visita Aceptada (${escapeHtml(sol.codigo)})</h2><p>Hola <strong>${escapeHtml(sol.ejecutivo_nombre)}</strong>,</p><p>Tu solicitud para <strong>${escapeHtml(sol.cliente)}</strong> (${escapeHtml(sol.distrito)}) programada el <strong>${escapeHtml(sol.fecha)}</strong> de <strong>${escapeHtml(sol.hora_salida)} a ${escapeHtml(sol.hora_retorno)}</strong> fue <strong>ACEPTADA</strong> por ${escapeHtml(actorNombre)}.</p><p><strong>Observación:</strong> ${escapeHtml(observacion || 'Sin observación adicional.')}</p></div>`,
      });
      for (const ar of autoRejected) {
        await sendCorporateEmail({
          to: [ar.ejecutivo_email],
          subject: `Solicitud ${ar.codigo} rechazada automáticamente por cruce de agenda`,
          text: `Hola ${ar.ejecutivo_nombre},\n\nTu solicitud ${ar.codigo} (${ar.cliente}, ${sol.fecha} ${ar.horario}) fue rechazada automáticamente: El asesor aceptó otra visita prioritaria en este bloque horario (${sol.codigo}).`,
          html: `<div style="font-family:Roboto,Arial,sans-serif;color:#0f172a;max-width:600px"><h2 style="color:#b91c1c;margin-bottom:8px">Solicitud Rechazada Automáticamente (${escapeHtml(ar.codigo)})</h2><p>Hola <strong>${escapeHtml(ar.ejecutivo_nombre)}</strong>,</p><p>Tu solicitud para <strong>${escapeHtml(ar.cliente)}</strong> (${escapeHtml(sol.fecha)} ${escapeHtml(ar.horario)}) fue rechazada automáticamente porque el asesor aceptó otra visita prioritaria en este bloque horario (${escapeHtml(sol.codigo)}).</p></div>`,
        });
      }
    }
  } else {
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE solicitudes
         SET estado = 'RECHAZADA', respondido_por = ?, fecha_respuesta = ?, observacion = ?, updated_at = ?
         WHERE id = ? AND estado = 'PENDIENTE'`
      ).run(actorEmail, now, observacion, now, sol.id);

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, ?, ?, ?, ?, 'RECHAZO', 'PENDIENTE', 'RECHAZADA', ?, ?)`
      ).run(
        crypto.randomUUID(),
        sol.id,
        sol.codigo,
        actorEmail,
        actorNombre,
        observacion || 'Visita rechazada por disponibilidad.',
        now
      );

      const execProfile = db
        .prepare('SELECT celular FROM profiles WHERE LOWER(email) = LOWER(?)')
        .get(sol.ejecutivo_email) as { celular: string } | undefined;

      whatsappVendedorUrl = execProfile
        ? buildWhatsAppUrl(
            execProfile.celular,
            `Hola ${sol.ejecutivo_nombre}, tu solicitud ${sol.codigo} para ${sol.cliente} (${sol.fecha} de ${sol.hora_salida} a ${sol.hora_retorno}) fue RECHAZADA por ${actorNombre}.${observacion ? ` Observación: ${observacion}` : ''}`
          )
        : null;

      db.prepare(
        `INSERT INTO notificaciones (id, destinatario_email, titulo, mensaje, tipo, solicitud_codigo, leida, whatsapp_url, created_at)
         VALUES (?, ?, ?, ?, 'respuesta', ?, 0, ?, ?)`
      ).run(
        crypto.randomUUID(),
        sol.ejecutivo_email,
        `Solicitud rechazada: ${sol.codigo}`,
        `${actorNombre} rechazó la visita ${sol.codigo} (${sol.cliente}).${observacion ? ` Observación: ${observacion}` : ''}`,
        sol.codigo,
        whatsappVendedorUrl,
        now
      );
    });
    tx();

    if (isSmtpConfigured()) {
      await sendCorporateEmail({
        to: [sol.ejecutivo_email],
        subject: `Visita RECHAZADA: ${sol.codigo} — ${sol.cliente}`,
        text: `Hola ${sol.ejecutivo_nombre},\n\nTu solicitud ${sol.codigo} para ${sol.cliente} (${sol.fecha} ${sol.hora_salida}-${sol.hora_retorno}) fue RECHAZADA por ${actorNombre}.\nObservación: ${observacion || 'Sin observación adicional.'}`,
        html: `<div style="font-family:Roboto,Arial,sans-serif;color:#0f172a;max-width:600px"><h2 style="color:#b91c1c;margin-bottom:8px">Visita Rechazada (${escapeHtml(sol.codigo)})</h2><p>Hola <strong>${escapeHtml(sol.ejecutivo_nombre)}</strong>,</p><p>Tu solicitud para <strong>${escapeHtml(sol.cliente)}</strong> (${escapeHtml(sol.fecha)} ${escapeHtml(sol.hora_salida)}–${escapeHtml(sol.hora_retorno)}) fue <strong>RECHAZADA</strong> por ${escapeHtml(actorNombre)}.</p><p><strong>Observación:</strong> ${escapeHtml(observacion || 'Sin observación adicional.')}</p></div>`,
      });
    }
  }

  const updated = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(sol.id) as Record<string, unknown>;
  return {
    solicitud: parseSolicitudRow(updated),
    autoRejectedCount: autoRejected.length,
    autoRejected,
    whatsappVendedorUrl,
    whatsappAutoRejectedUrls: autoRejected.map((a) => ({ codigo: a.codigo, url: a.whatsappUrl })),
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();
  router.use(requireCsrfHeader);

  // ---------------- AUTH ROUTES ----------------
  router.get('/auth/session', (req, res) => {
    const ctx = getAuthContextFromRequest(req);
    const setupNeeded = needsInitialAdminSetup();
    const smtpConfigured = isSmtpConfigured();

    if (!ctx) {
      res.json({
        authenticated: false,
        needsInitialAdminSetup: setupNeeded,
        smtpConfigured,
        user: null,
        profile: null,
        profileStatus: 'UNAUTHENTICATED',
      });
      return;
    }

    const profileStatus = !ctx.profile
      ? 'MISSING'
      : ctx.profile.activo
        ? 'ACTIVE'
        : 'DISABLED';

    res.json({
      authenticated: true,
      needsInitialAdminSetup: setupNeeded,
      smtpConfigured,
      user: {
        id: ctx.userId,
        email: ctx.email,
        emailVerified: ctx.emailVerified,
        mfaEnabled: ctx.mfaEnabled,
      },
      profile: ctx.profile,
      profileStatus,
    });
  });

  router.post('/auth/setup-admin', (req, res) => {
    if (!needsInitialAdminSetup()) {
      res.status(403).json({ error: 'La cuenta inicial de administrador ya fue configurada.' });
      return;
    }

    const email = normalizeCorporateEmail(String(req.body?.email || 'admin@mipersa.pe'));
    const nombre = String(req.body?.nombre || 'Administrador MIPERSA').trim();
    const password = String(req.body?.password || '');

    if (!isValidMipersaEmail(email)) {
      res.status(400).json({ error: 'El correo debe pertenecer al dominio corporativo @mipersa.pe.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (existingUser) {
      res.status(409).json({ error: 'Este correo ya tiene credenciales registradas.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const pwHash = hashPassword(password);

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, email_verified, mfa_enabled, created_at)
         VALUES (?, ?, ?, 1, 0, ?)`
      ).run(userId, email, pwHash, now);

      const existingProfile = db
        .prepare('SELECT id FROM profiles WHERE LOWER(email) = ?')
        .get(email) as { id: string } | undefined;

      if (existingProfile) {
        db.prepare(
          `UPDATE profiles SET rol = 'admin', activo = 1, nombre = CASE WHEN ? != '' THEN ? ELSE nombre END, updated_at = ?
           WHERE id = ?`
        ).run(nombre, nombre, now, existingProfile.id);
      } else {
        db.prepare(
          `INSERT INTO profiles (id, email, nombre, rol, celular, especialidad, activo, cartera_clientes, created_at, updated_at)
           VALUES (?, ?, ?, 'admin', '', 'Administración General', 1, '[]', ?, ?)`
        ).run(crypto.randomUUID(), email, nombre || 'Administrador MIPERSA', now, now);
      }
    });
    tx();

    const sessionToken = signSessionToken({ uid: userId, email, purpose: 'session' }, SESSION_TTL);
    res.cookie(SESSION_COOKIE, sessionToken, getCookieOptions(req, SESSION_TTL * 1000));
    res.json({ ok: true, returnTo: isSafeReturnTo(req.body?.returnTo) });
  });

  router.post('/auth/login', (req, res) => {
    const email = normalizeCorporateEmail(String(req.body?.email || ''));
    const password = String(req.body?.password || '');
    const returnTo = isSafeReturnTo(req.body?.returnTo);

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
      return;
    }

    const userRow = db
      .prepare('SELECT id, email, password_hash, email_verified, mfa_enabled FROM users WHERE LOWER(email) = ?')
      .get(email) as
      | {
          id: string;
          email: string;
          password_hash: string;
          email_verified: number;
          mfa_enabled: number;
        }
      | undefined;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'Correo electrónico o contraseña incorrectos.' });
      return;
    }

    if (userRow.email_verified !== 1 && isSmtpConfigured()) {
      res.status(403).json({
        error: 'Debes verificar tu correo electrónico antes de iniciar sesión.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    if (userRow.mfa_enabled === 1) {
      const mfaToken = signSessionToken(
        { uid: userRow.id, email: userRow.email, purpose: 'mfa' },
        300
      );
      res.json({
        mfaRequired: true,
        mfaToken,
        returnTo,
      });
      return;
    }

    const sessionToken = signSessionToken(
      { uid: userRow.id, email: userRow.email, purpose: 'session' },
      SESSION_TTL
    );
    res.cookie(SESSION_COOKIE, sessionToken, getCookieOptions(req, SESSION_TTL * 1000));
    res.json({ ok: true, mfaRequired: false, returnTo });
  });

  router.post('/auth/mfa/verify', (req, res) => {
    const mfaToken = String(req.body?.mfaToken || '');
    const code = String(req.body?.code || '');
    const returnTo = isSafeReturnTo(req.body?.returnTo);

    const payload = verifySessionToken(mfaToken, 'mfa');
    if (!payload) {
      res.status(401).json({ error: 'El desafío MFA expiró. Vuelve a iniciar sesión.' });
      return;
    }

    const userRow = db
      .prepare('SELECT id, email, mfa_secret FROM users WHERE id = ?')
      .get(payload.uid) as { id: string; email: string; mfa_secret: string | null } | undefined;

    if (!userRow || !userRow.mfa_secret || !verifyTotpCode(userRow.mfa_secret, code)) {
      res.status(401).json({ error: 'Código de verificación MFA inválido.' });
      return;
    }

    const sessionToken = signSessionToken(
      { uid: userRow.id, email: userRow.email, purpose: 'session' },
      SESSION_TTL
    );
    res.cookie(SESSION_COOKIE, sessionToken, getCookieOptions(req, SESSION_TTL * 1000));
    res.json({ ok: true, returnTo });
  });

  router.post('/auth/register', async (req, res) => {
    const email = normalizeCorporateEmail(String(req.body?.email || ''));
    const password = String(req.body?.password || '');
    const returnTo = isSafeReturnTo(req.body?.returnTo);

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }

    const authorizedProfileRow = db
      .prepare('SELECT activo FROM profiles WHERE LOWER(email) = ?')
      .get(email) as { activo: number } | undefined;

    if (!isValidMipersaEmail(email) && (!authorizedProfileRow || authorizedProfileRow.activo !== 1)) {
      res.status(403).json({
        error:
          'Solo se permiten correos @mipersa.pe o correos externos previamente autorizados por un Administrador.',
      });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (existing) {
      res.status(409).json({ error: 'Ya existe una cuenta registrada con este correo.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const rawVerifyToken = generateRandomToken(24);
    const verifyHash = hashToken(rawVerifyToken);
    const verifyExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const smtpActive = isSmtpConfigured();

    // Si SMTP está configurado requiere verificación por enlace de correo.
    // Si no está configurado, se marca email_verified=1 y el acceso queda sujeto a que exista perfil activo en MIPERSA.
    db.prepare(
      `INSERT INTO users (id, email, password_hash, email_verified, verification_token_hash, verification_expires, mfa_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      userId,
      email,
      hashPassword(password),
      smtpActive ? 0 : 1,
      verifyHash,
      verifyExpires,
      now
    );

    const profileRow = authorizedProfileRow;

    let emailSent = false;
    let emailDetail = '';

    if (smtpActive) {
      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(rawVerifyToken)}&returnTo=${encodeURIComponent(returnTo)}`;
      const mailRes = await sendCorporateEmail({
        to: [email],
        subject: 'Verifica tu cuenta — Gestor de Visitas MIPERSA',
        text: `Hola,\n\nPara verificar tu correo en Gestor de Visitas MIPERSA, abre el siguiente enlace:\n${verifyUrl}\n\nEste enlace expira en 24 horas.`,
      });
      emailSent = mailRes.sent;
      emailDetail = mailRes.detail;
    }

    if (!smtpActive) {
      const sessionToken = signSessionToken({ uid: userId, email, purpose: 'session' }, SESSION_TTL);
      res.cookie(SESSION_COOKIE, sessionToken, getCookieOptions(req, SESSION_TTL * 1000));
    }

    res.status(201).json({
      ok: true,
      emailVerificationRequired: smtpActive,
      emailSent,
      emailDetail,
      profileEnabled: Boolean(profileRow && profileRow.activo === 1),
      returnTo,
    });
  });

  router.post('/auth/verify-email', (req, res) => {
    const rawToken = String(req.body?.token || '');
    const returnTo = isSafeReturnTo(req.body?.returnTo);
    if (!rawToken) {
      res.status(400).json({ error: 'Token de verificación faltante.' });
      return;
    }

    const tokenHash = hashToken(rawToken);
    const userRow = db
      .prepare(
        `SELECT id, email, verification_expires FROM users WHERE verification_token_hash = ?`
      )
      .get(tokenHash) as
      | { id: string; email: string; verification_expires: string | null }
      | undefined;

    if (!userRow || !userRow.verification_expires || userRow.verification_expires < new Date().toISOString()) {
      res.status(400).json({ error: 'El enlace de verificación es inválido o ha expirado.' });
      return;
    }

    db.prepare(
      `UPDATE users SET email_verified = 1, verification_token_hash = NULL, verification_expires = NULL WHERE id = ?`
    ).run(userRow.id);

    const sessionToken = signSessionToken(
      { uid: userRow.id, email: userRow.email, purpose: 'session' },
      SESSION_TTL
    );
    res.cookie(SESSION_COOKIE, sessionToken, getCookieOptions(req, SESSION_TTL * 1000));
    res.json({ ok: true, email: userRow.email, returnTo });
  });

  router.post('/auth/forgot-password', async (req, res) => {
    const email = normalizeCorporateEmail(String(req.body?.email || ''));
    const returnTo = isSafeReturnTo(req.body?.returnTo);

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
      return;
    }

    const userRow = db
      .prepare('SELECT id, email FROM users WHERE LOWER(email) = ?')
      .get(email) as { id: string; email: string } | undefined;

    if (!isSmtpConfigured()) {
      res.status(200).json({
        sent: false,
        reason: 'SMTP_NOT_CONFIGURED',
        message:
          'El servidor de correo SMTP no está configurado. Solicita al Administrador de MIPERSA que genere un enlace de restablecimiento desde Gestión de Perfiles.',
      });
      return;
    }

    if (userRow) {
      const rawToken = generateRandomToken(24);
      const tokenHash = hashToken(rawToken);
      const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET reset_token_hash = ?, reset_expires = ? WHERE id = ?').run(
        tokenHash,
        expires,
        userRow.id
      );

      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}&returnTo=${encodeURIComponent(returnTo)}`;
      const mailRes = await sendCorporateEmail({
        to: [userRow.email],
        subject: 'Recuperar contraseña — Gestor de Visitas MIPERSA',
        text: `Hola,\n\nRecibimos una solicitud para restablecer tu contraseña.\nAbre el siguiente enlace (válido por 30 minutos):\n${resetUrl}\n\nSi no solicitaste este cambio, ignora este mensaje.`,
      });

      if (!mailRes.sent) {
        res.status(502).json({
          sent: false,
          message: mailRes.detail,
        });
        return;
      }
    }

    res.json({
      sent: true,
      message: 'Si el correo está registrado, se ha enviado un enlace de recuperación a tu bandeja.',
    });
  });

  router.post('/auth/reset-password', (req, res) => {
    const rawToken = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const returnTo = isSafeReturnTo(req.body?.returnTo);

    if (!rawToken) {
      res.status(400).json({ error: 'Token de restablecimiento faltante.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      return;
    }

    const tokenHash = hashToken(rawToken);
    const userRow = db
      .prepare('SELECT id, email, reset_expires FROM users WHERE reset_token_hash = ?')
      .get(tokenHash) as { id: string; email: string; reset_expires: string | null } | undefined;

    if (!userRow || !userRow.reset_expires || userRow.reset_expires < new Date().toISOString()) {
      res.status(400).json({ error: 'El enlace de restablecimiento es inválido o expiró.' });
      return;
    }

    db.prepare(
      'UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires = NULL, email_verified = 1 WHERE id = ?'
    ).run(hashPassword(password), userRow.id);

    res.json({ ok: true, returnTo });
  });

  router.post('/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, getCookieOptions(req));
    res.json({ ok: true });
  });

  // MFA management for authenticated users
  router.post('/auth/mfa/setup', requireAuth, (req, res) => {
    const ctx = req.authCtx!;
    const secret = generateTotpSecret();
    db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, ctx.userId);
    res.json({
      secret,
      otpauthUri: buildTotpUri(ctx.email, secret),
    });
  });

  router.post('/auth/mfa/enable', requireAuth, (req, res) => {
    const ctx = req.authCtx!;
    const code = String(req.body?.code || '');
    const userRow = db
      .prepare('SELECT mfa_secret FROM users WHERE id = ?')
      .get(ctx.userId) as { mfa_secret: string | null } | undefined;

    if (!userRow?.mfa_secret || !verifyTotpCode(userRow.mfa_secret, code)) {
      res.status(400).json({ error: 'El código de 6 dígitos no coincide. Verifica tu aplicación autenticadora.' });
      return;
    }

    db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(ctx.userId);
    res.json({ ok: true, mfaEnabled: true });
  });

  router.post('/auth/mfa/disable', requireAuth, (req, res) => {
    const ctx = req.authCtx!;
    const password = String(req.body?.password || '');
    const userRow = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(ctx.userId) as { password_hash: string } | undefined;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'Contraseña incorrecta para desactivar MFA.' });
      return;
    }

    db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(ctx.userId);
    res.json({ ok: true, mfaEnabled: false });
  });

  // ---------------- BOOTSTRAP & POLLING ----------------
  router.get('/bootstrap', requireActiveProfile, (req, res) => {
    const profile = req.authCtx!.profile!;

    const cfgRow = db.prepare('SELECT * FROM configuracion WHERE id = 1').get() as {
      id: number;
      nombre_sistema: string;
      margen_minutos: number;
      permitir_cliente_compartido?: number;
      updated_at: string;
    };

    const distritosRows = db
      .prepare('SELECT id, nombre, provincia, departamento, activo FROM distritos WHERE activo = 1 ORDER BY nombre ASC')
      .all() as Array<{
      id: string;
      nombre: string;
      provincia: string;
      departamento: string;
      activo: number;
    }>;
    const distritos = distritosRows.map((d) => ({ ...d, activo: Number(d.activo) === 1 }));

    const clientesQuery = 'SELECT id, nombre, ruc, sector, activo FROM clientes WHERE activo = 1 ORDER BY nombre ASC';
    const allActiveClients = db.prepare(clientesQuery).all() as Array<{
      id: string;
      nombre: string;
      ruc: string;
      sector: string;
      activo: number;
    }>;

    // RBAC estricto para clientes visibles en solicitudes:
    // - vendedor: exclusivamente los clientes asignados en su cartera_clientes
    // - tecnico: sin acceso a cartera comercial
    // - admin: toda la cartera activa
    const clientes =
      profile.rol === 'vendedor'
        ? allActiveClients.filter((c) => profile.cartera_clientes.includes(c.nombre))
        : profile.rol === 'tecnico'
          ? []
          : allActiveClients;

    const activeTecnicosRows = db
      .prepare("SELECT * FROM profiles WHERE rol = 'tecnico' AND activo = 1 ORDER BY nombre ASC")
      .all() as Array<Record<string, unknown>>;
    const tecnicos = activeTecnicosRows.map(parseProfileRow);

    const ejecutivosRows =
      profile.rol === 'tecnico'
        ? []
        : (db
            .prepare("SELECT * FROM profiles WHERE rol IN ('vendedor', 'admin') AND activo = 1 ORDER BY nombre ASC")
            .all() as Array<Record<string, unknown>>);
    const ejecutivos = ejecutivosRows.map(parseProfileRow);

    // RBAC strict query: tecnico ONLY sees their own solicitudes and bloqueos (orden cronológico descendente)
    const solRows =
      profile.rol === 'tecnico'
        ? (db
            .prepare('SELECT * FROM solicitudes WHERE tecnico_id = ? ORDER BY created_at DESC, fecha DESC, hora_salida ASC')
            .all(profile.id) as Array<Record<string, unknown>>)
        : (db
            .prepare('SELECT * FROM solicitudes ORDER BY created_at DESC, fecha DESC, hora_salida ASC')
            .all() as Array<Record<string, unknown>>);

    const solicitudes = solRows.map(parseSolicitudRow);

    const bloqRows =
      profile.rol === 'tecnico'
        ? (db
            .prepare('SELECT * FROM bloqueos WHERE tecnico_id = ? ORDER BY fecha ASC')
            .all(profile.id) as Array<Record<string, unknown>>)
        : (db.prepare('SELECT * FROM bloqueos ORDER BY fecha ASC').all() as Array<Record<string, unknown>>);

    const notificacionesRows = db
      .prepare(
        `SELECT * FROM notificaciones
         WHERE LOWER(destinatario_email) = LOWER(?)
         ORDER BY created_at DESC
         LIMIT 30`
      )
      .all(profile.email) as Array<Record<string, unknown>>;

    res.json({
      configuracion: {
        ...cfgRow,
        permitir_cliente_compartido: Number(cfgRow.permitir_cliente_compartido ?? 1) === 1,
      },
      clientes: clientes.map((c) => ({ ...c, activo: c.activo === 1 })),
      distritos,
      tecnicos,
      ejecutivos,
      solicitudes,
      bloqueos: bloqRows,
      notificaciones: notificacionesRows.map((n) => ({
        ...n,
        leida: Number(n.leida) === 1,
      })),
      serverTime: new Date().toISOString(),
    });
  });

  // ---------------- PRIVATE FILES ----------------
  router.post('/files/upload', requireActiveProfile, upload.array('files', 5), (req, res) => {
    const profile = req.authCtx!.profile!;
    const entityType = String(req.body?.entityType || 'solicitud');
    const entityId = String(req.body?.entityId || '');
    const files = (req.files as Express.Multer.File[]) || [];

    if (files.length === 0) {
      res.status(400).json({ error: 'No se recibieron imágenes válidas.' });
      return;
    }

    const saved: FileRef[] = [];
    const now = new Date().toISOString();

    for (const f of files) {
      const detectedMime = detectImageMime(f.buffer);
      if (!detectedMime) {
        res.status(400).json({
          error: `El archivo "${f.originalname}" no es una imagen JPEG o PNG válida.`,
        });
        return;
      }
      const ext = detectedMime === 'image/png' ? 'png' : 'jpg';
      const id = crypto.randomUUID();
      const storageName = `${id}.${ext}`;
      const destPath = resolveSafeUploadPath(UPLOAD_DIR, storageName);
      fs.writeFileSync(destPath, f.buffer);

      db.prepare(
        `INSERT INTO archivos (id, storage_name, original_name, mime_type, size_bytes, owner_email, entity_type, entity_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, storageName, f.originalname.slice(0, 120), detectedMime, f.size, profile.email, entityType, entityId, now);

      saved.push({
        id,
        name: f.originalname.slice(0, 120),
        mimeType: detectedMime,
        url: signFileUrl(id, 900),
      });
    }

    res.status(201).json({ files: saved });
  });

  router.get('/files/:id', (req, res) => {
    const fileId = String(req.params.id || '');
    const exp = String(req.query.exp || '');
    const sig = String(req.query.sig || '');

    const hasValidSignature = Boolean(exp && sig && verifyFileSignature(fileId, exp, sig));
    const ctx = getAuthContextFromRequest(req);

    if (!hasValidSignature && (!ctx || !ctx.profile || !ctx.profile.activo)) {
      res.status(403).json({ error: 'Enlace temporal expirado o sin autorización.' });
      return;
    }

    const row = db
      .prepare('SELECT storage_name, mime_type, owner_email, entity_id FROM archivos WHERE id = ?')
      .get(fileId) as
      | { storage_name: string; mime_type: string; owner_email: string; entity_id: string }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Archivo no encontrado.' });
      return;
    }

    // Si accede por sesión sin firma, validar RBAC si es técnico
    if (!hasValidSignature && ctx?.profile?.rol === 'tecnico') {
      const isOwner = row.owner_email.toLowerCase() === ctx.profile.email.toLowerCase();
      if (!isOwner && row.entity_id) {
        const sol = db
          .prepare('SELECT tecnico_id FROM solicitudes WHERE id = ?')
          .get(row.entity_id) as { tecnico_id: string } | undefined;
        if (!sol || sol.tecnico_id !== ctx.profile.id) {
          res.status(403).json({ error: 'Acceso denegado a este archivo.' });
          return;
        }
      }
    }

    try {
      const filePath = resolveSafeUploadPath(UPLOAD_DIR, row.storage_name);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Archivo físico no encontrado.' });
        return;
      }
      res.setHeader('Content-Type', row.mime_type);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(filePath);
    } catch {
      res.status(403).json({ error: 'Acceso inválido.' });
    }
  });

  // ---------------- SOLICITUDES ----------------
  // Enlace rápido firmado (desde correo / WhatsApp) — GET solo lectura, POST ejecuta decisión
  router.get('/solicitudes/quick-action', (req, res) => {
    const token = String(req.query.token || '');
    const payload = verifyQuickActionToken(token);
    if (!payload) {
      res.status(400).json({ error: 'El enlace de respuesta rápida es inválido o ha expirado.' });
      return;
    }

    const solRow = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(payload.solicitudId) as
      | Record<string, unknown>
      | undefined;
    if (!solRow) {
      res.status(404).json({ error: 'La solicitud asociada ya no existe.' });
      return;
    }

    const sol = parseSolicitudRow(solRow);
    const tecRow = db
      .prepare("SELECT id, nombre, email, activo FROM profiles WHERE id = ? AND rol = 'tecnico'")
      .get(payload.tecnicoId) as
      | { id: string; nombre: string; email: string; activo: number }
      | undefined;

    if (!tecRow || tecRow.activo !== 1 || sol.tecnico_id !== tecRow.id) {
      res.status(403).json({ error: 'Este enlace no corresponde al asesor técnico activo asignado.' });
      return;
    }

    res.json({
      valid: true,
      accion: payload.accion,
      canConfirm: sol.estado === 'PENDIENTE',
      solicitud: sol,
      tecnicoNombre: tecRow.nombre,
    });
  });

  router.post('/solicitudes/quick-action', async (req, res) => {
    const token = String(req.body?.token || '');
    const observacion = String(req.body?.observacion || '').trim();
    const overrideAccion = String(req.body?.accion || '').toUpperCase();

    const payload = verifyQuickActionToken(token);
    if (!payload) {
      res.status(400).json({ error: 'El enlace de respuesta rápida es inválido o ha expirado.' });
      return;
    }

    const accion: 'ACEPTAR' | 'RECHAZAR' =
      overrideAccion === 'ACEPTAR' || overrideAccion === 'RECHAZAR' ? overrideAccion : payload.accion;

    const solRow = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(payload.solicitudId) as
      | Record<string, unknown>
      | undefined;
    if (!solRow) {
      res.status(404).json({ error: 'Solicitud no encontrada.' });
      return;
    }
    const sol = parseSolicitudRow(solRow);

    const tecRow = db
      .prepare("SELECT id, nombre, email, activo FROM profiles WHERE id = ? AND rol = 'tecnico'")
      .get(payload.tecnicoId) as
      | { id: string; nombre: string; email: string; activo: number }
      | undefined;

    if (!tecRow || tecRow.activo !== 1 || sol.tecnico_id !== tecRow.id) {
      res.status(403).json({ error: 'Solo el asesor técnico asignado puede confirmar esta acción.' });
      return;
    }

    if (sol.estado !== 'PENDIENTE') {
      res.status(409).json({
        error: `Esta solicitud ya fue respondida previamente (${sol.estado}) y no puede modificarse.`,
      });
      return;
    }

    try {
      const result = await executeSolicitudResponse({
        sol,
        actorEmail: tecRow.email,
        actorNombre: tecRow.nombre,
        accion,
        observacion,
      });
      res.json(result);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.get('/solicitudes/:key', requireActiveProfile, (req, res) => {
    const profile = req.authCtx!.profile!;
    const key = String(req.params.key || '');
    const row = db
      .prepare('SELECT * FROM solicitudes WHERE id = ? OR codigo = ?')
      .get(key, key) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Solicitud no encontrada.' });
      return;
    }

    const sol = parseSolicitudRow(row);
    if (!canAccessSolicitud(profile, sol)) {
      res.status(403).json({ error: 'No tienes permiso para ver esta solicitud.' });
      return;
    }

    const repRow = db
      .prepare('SELECT * FROM reportes WHERE solicitud_id = ?')
      .get(sol.id) as Record<string, unknown> | undefined;

    let reporte = null;
    if (repRow) {
      let acts: string[] = [];
      let dests: string[] = [];
      try {
        acts = JSON.parse(String(repRow.actividades || '[]'));
      } catch {
        acts = [];
      }
      try {
        dests = JSON.parse(String(repRow.email_destinatarios || '[]'));
      } catch {
        dests = [];
      }
      reporte = {
        id: String(repRow.id),
        solicitud_id: String(repRow.solicitud_id),
        codigo_visita: String(repRow.codigo_visita),
        actividades: acts,
        recomendaciones: String(repRow.recomendaciones || ''),
        pendientes: String(repRow.pendientes || ''),
        imagenes_actividades: hydrateFileRefs(String(repRow.imagenes_actividades || '[]')),
        imagenes_recomendaciones: hydrateFileRefs(String(repRow.imagenes_recomendaciones || '[]')),
        imagenes_pendientes: hydrateFileRefs(String(repRow.imagenes_pendientes || '[]')),
        fecha_culminacion: String(repRow.fecha_culminacion),
        hora_culminacion: String(repRow.hora_culminacion),
        autor_email: String(repRow.autor_email),
        estado_envio: String(repRow.estado_envio),
        email_enviado: Number(repRow.email_enviado) === 1,
        email_detalle: String(repRow.email_detalle || ''),
        email_destinatarios: dests,
        pdf_generado_at: repRow.pdf_generado_at ? String(repRow.pdf_generado_at) : null,
        created_at: String(repRow.created_at),
        updated_at: String(repRow.updated_at),
      };
    }

    const historial = db
      .prepare('SELECT * FROM historial WHERE solicitud_id = ? ORDER BY fecha_registro ASC')
      .all(sol.id);

    const tecnicoRow = db
      .prepare('SELECT celular FROM profiles WHERE id = ?')
      .get(sol.tecnico_id) as { celular: string } | undefined;

    res.json({
      solicitud: sol,
      reporte,
      historial,
      whatsappTecnicoUrl: tecnicoRow
        ? buildWhatsAppUrl(
            tecnicoRow.celular,
            `Hola ${sol.tecnico_nombre}, te consulto sobre la visita ${sol.codigo} (${sol.cliente}, ${sol.fecha} ${sol.hora_salida}-${sol.hora_retorno}).`
          )
        : null,
      whatsappContactoUrl: buildWhatsAppUrl(
        sol.contacto_celular,
        `Estimado(a) ${sol.contacto_nombre}, le saluda el equipo de MIPERSA respecto a la visita ${sol.codigo} programada para el ${sol.fecha}.`
      ),
    });
  });

  router.post('/solicitudes/check-availability', requireRoles(['vendedor', 'admin']), (req, res) => {
    const tecnicoId = String(req.body?.tecnico_id || '');
    const fecha = String(req.body?.fecha || '');
    const horaSalida = String(req.body?.hora_salida || '');
    const horaRetorno = String(req.body?.hora_retorno || '');

    if (!tecnicoId || !isValidDateYYYYMMDD(fecha) || !isValidTimeHHMM(horaSalida) || !isValidTimeHHMM(horaRetorno)) {
      res.status(400).json({ available: false, reason: 'Completa técnico, fecha y horario válido.' });
      return;
    }
    if (parseTimeToMinutes(horaRetorno) <= parseTimeToMinutes(horaSalida)) {
      res.status(400).json({ available: false, reason: 'La hora de retorno debe ser posterior a la hora de salida.' });
      return;
    }

    const result = checkTechnicianAvailability({
      tecnicoId,
      fecha,
      horaSalida,
      horaRetorno,
    });
    res.json(result);
  });

  router.post('/solicitudes', requireRoles(['vendedor', 'admin']), async (req, res) => {
    const profile = req.authCtx!.profile!;
    const body = req.body || {};

    let ejecutivoEmail = profile.email;
    let ejecutivoNombre = profile.nombre;
    let ownerProfile = profile;

    if (profile.rol === 'admin' && body.ejecutivo_email) {
      const targetEmail = normalizeCorporateEmail(String(body.ejecutivo_email));
      const foundExec = db
        .prepare("SELECT * FROM profiles WHERE LOWER(email) = ? AND activo = 1 AND rol IN ('vendedor', 'admin')")
        .get(targetEmail) as Record<string, unknown> | undefined;
      if (!foundExec) {
        res.status(400).json({ error: 'El ejecutivo comercial seleccionado no existe o está inactivo.' });
        return;
      }
      ownerProfile = parseProfileRow(foundExec);
      ejecutivoEmail = ownerProfile.email;
      ejecutivoNombre = ownerProfile.nombre;
    }

    const cliente = String(body.cliente || '').trim();
    const distrito = String(body.distrito || '').trim();
    const fecha = String(body.fecha || '').trim();
    const horaSalida = String(body.hora_salida || '').trim();
    const horaRetorno = String(body.hora_retorno || '').trim();
    const motivo = String(body.motivo || '').trim();
    const motivoOtro = String(body.motivo_otro || '').trim();
    const tecnicoId = String(body.tecnico_id || '').trim();
    const contactoNombre = String(body.contacto_nombre || '').trim();
    const contactoCargo = String(body.contacto_cargo || '').trim();
    const contactoCelular = String(body.contacto_celular || '').trim();
    const descripcion = String(body.descripcion || '').trim();

    if (!cliente || !distrito || !fecha || !horaSalida || !horaRetorno || !motivo || !tecnicoId || !contactoNombre || !contactoCargo || !contactoCelular || !descripcion) {
      res.status(400).json({ error: 'Todos los campos obligatorios de la solicitud deben completarse.' });
      return;
    }
    if (motivo === 'Otro' && !motivoOtro) {
      res.status(400).json({ error: 'Debes especificar el detalle cuando el motivo es "Otro".' });
      return;
    }
    if (!isValidDateYYYYMMDD(fecha)) {
      res.status(400).json({ error: 'Formato de fecha inválido. Usa YYYY-MM-DD.' });
      return;
    }
    if (!isValidTimeHHMM(horaSalida) || !isValidTimeHHMM(horaRetorno)) {
      res.status(400).json({ error: 'Formato de hora inválido. Usa HH:MM.' });
      return;
    }
    if (parseTimeToMinutes(horaRetorno) <= parseTimeToMinutes(horaSalida)) {
      res.status(400).json({ error: 'La hora de retorno debe ser posterior a la hora de salida.' });
      return;
    }

    // Validar cliente oficial y cartera del ejecutivo (regla estricta)
    const clientRow = db
      .prepare('SELECT nombre FROM clientes WHERE nombre = ? AND activo = 1')
      .get(cliente) as { nombre: string } | undefined;
    if (!clientRow) {
      res.status(400).json({ error: 'Selecciona un cliente oficial activo válido de la lista.' });
      return;
    }
    if (profile.rol === 'vendedor') {
      if (!profile.cartera_clientes.includes(cliente)) {
        res.status(403).json({
          error: 'El cliente seleccionado no pertenece a tu cartera comercial asignada.',
        });
        return;
      }
    } else if (profile.rol === 'admin' && body.usar_cartera_general !== true && ownerProfile.rol === 'vendedor') {
      if (!ownerProfile.cartera_clientes.includes(cliente)) {
        res.status(400).json({
          error: `El cliente seleccionado no figura en la cartera de ${ownerProfile.nombre}. Activa "cartera general" si deseas asignarlo excepcionalmente.`,
        });
        return;
      }
    }

    // Validar distrito oficial activo
    const distRow = db.prepare('SELECT nombre FROM distritos WHERE nombre = ? AND activo = 1').get(distrito);
    if (!distRow) {
      res.status(400).json({ error: 'Selecciona un distrito oficial activo válido de la lista.' });
      return;
    }

    // Validar técnico activo
    const tecRow = db
      .prepare("SELECT * FROM profiles WHERE id = ? AND rol = 'tecnico' AND activo = 1")
      .get(tecnicoId) as Record<string, unknown> | undefined;
    if (!tecRow) {
      res.status(400).json({ error: 'El técnico seleccionado no está activo o no existe.' });
      return;
    }
    const tecnico = parseProfileRow(tecRow);

    // Validar disponibilidad y cruces en servidor
    const avail = checkTechnicianAvailability({
      tecnicoId: tecnico.id,
      fecha,
      horaSalida,
      horaRetorno,
    });
    if (!avail.available) {
      res.status(409).json({
        error: avail.reason || 'El técnico no está disponible en la fecha y horario solicitados.',
        conflictType: avail.conflictType,
        blockingDetails: avail.blockingDetails,
      });
      return;
    }

    const imagenes = validateImageIdList(body.imagenes, 5);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const baseUrl = getRequestBaseUrl(req);
    const acceptToken = signQuickActionToken({ solicitudId: id, tecnicoId: tecnico.id, accion: 'ACEPTAR' });
    const rejectToken = signQuickActionToken({ solicitudId: id, tecnicoId: tecnico.id, accion: 'RECHAZAR' });
    const acceptUrl = `${baseUrl}/respuesta-rapida?token=${encodeURIComponent(acceptToken)}`;
    const rejectUrl = `${baseUrl}/respuesta-rapida?token=${encodeURIComponent(rejectToken)}`;

    let codigo = '';
    let waUrl: string | null = null;
    const tx = db.transaction(() => {
      codigo = generateNextSolicitudCode();
      db.prepare(
        `INSERT INTO solicitudes (
          id, codigo, ejecutivo_email, ejecutivo_nombre, cliente, distrito, fecha,
          hora_salida, hora_retorno, motivo, motivo_otro, tecnico_id, tecnico_nombre,
          contacto_nombre, contacto_cargo, contacto_celular, descripcion, imagenes,
          estado, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?)`
      ).run(
        id,
        codigo,
        ejecutivoEmail,
        ejecutivoNombre,
        cliente,
        distrito,
        fecha,
        horaSalida,
        horaRetorno,
        motivo,
        motivo === 'Otro' ? motivoOtro : '',
        tecnico.id,
        tecnico.nombre,
        contactoNombre,
        contactoCargo,
        contactoCelular,
        descripcion,
        JSON.stringify(imagenes),
        now,
        now
      );

      for (const img of imagenes) {
        db.prepare('UPDATE archivos SET entity_id = ? WHERE id = ?').run(id, img.id);
      }

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, ?, ?, ?, ?, 'CREACION', NULL, 'PENDIENTE', ?, ?)`
      ).run(
        crypto.randomUUID(),
        id,
        codigo,
        profile.email,
        profile.nombre,
        `Solicitud registrada para ${cliente} (${distrito}) el ${fecha} de ${horaSalida} a ${horaRetorno}.`,
        now
      );

      const waSummary =
        `Hola ${tecnico.nombre}, nueva solicitud asignada (${codigo}):\n` +
        `• Cliente: ${cliente}\n` +
        `• Distrito: ${distrito}\n` +
        `• Fecha: ${fecha} (${horaSalida}–${horaRetorno})\n` +
        `• Vendedor: ${ejecutivoNombre}\n` +
        `• Motivo: ${motivo}${motivo === 'Otro' && motivoOtro ? ` (${motivoOtro})` : ''}\n` +
        `• Contacto: ${contactoNombre} (${contactoCelular})\n\n` +
        `Responder en 1 clic:\n` +
        `✓ Aceptar: ${acceptUrl}\n` +
        `✕ Rechazar: ${rejectUrl}`;

      waUrl = buildWhatsAppUrl(tecnico.celular, waSummary);
      db.prepare(
        `INSERT INTO notificaciones (id, destinatario_email, titulo, mensaje, tipo, solicitud_codigo, leida, whatsapp_url, created_at)
         VALUES (?, ?, ?, ?, 'asignacion', ?, 0, ?, ?)`
      ).run(
        crypto.randomUUID(),
        tecnico.email,
        `Nueva solicitud asignada: ${codigo}`,
        `${ejecutivoNombre} solicitó visita a ${cliente} (${distrito}) para el ${fecha} de ${horaSalida} a ${horaRetorno}.`,
        codigo,
        waUrl,
        now
      );
    });
    tx();

    // Notificar por correo si SMTP está configurado (incluyendo enlaces directos de Aceptar / Rechazar)
    if (isSmtpConfigured()) {
      const motivoFinal = motivo === 'Otro' && motivoOtro ? `${motivo} (${motivoOtro})` : motivo;
      await sendCorporateEmail({
        to: [tecnico.email],
        subject: `Nueva solicitud de visita ${codigo} — ${cliente}`,
        text:
          `Hola ${tecnico.nombre},\n\n` +
          `Se ha registrado una nueva solicitud de visita (${codigo}):\n` +
          `Vendedor: ${ejecutivoNombre}\n` +
          `Cliente: ${cliente}\n` +
          `Distrito: ${distrito}\n` +
          `Fecha: ${fecha}\n` +
          `Horario: ${horaSalida} - ${horaRetorno}\n` +
          `Motivo: ${motivoFinal}\n` +
          `Contacto: ${contactoNombre} (${contactoCargo}) - ${contactoCelular}\n` +
          `Descripción: ${descripcion}\n\n` +
          `Responder en 1 clic:\n` +
          `Aceptar visita: ${acceptUrl}\n` +
          `Rechazar visita: ${rejectUrl}`,
        html:
          `<div style="font-family:Roboto,Arial,sans-serif;color:#0f172a;max-width:600px">` +
          `<h2 style="color:#061A3E;margin-bottom:8px">Nueva solicitud asignada: ${escapeHtml(codigo)}</h2>` +
          `<p>Hola <strong>${escapeHtml(tecnico.nombre)}</strong>, tienes una nueva solicitud de acompañamiento técnico:</p>` +
          `<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px">` +
          `<tr><td style="padding:6px 0;color:#64748b">Vendedor:</td><td style="padding:6px 0;font-weight:600">${escapeHtml(ejecutivoNombre)}</td></tr>` +
          `<tr><td style="padding:6px 0;color:#64748b">Cliente:</td><td style="padding:6px 0;font-weight:600">${escapeHtml(cliente)}</td></tr>` +
          `<tr><td style="padding:6px 0;color:#64748b">Distrito:</td><td style="padding:6px 0">${escapeHtml(distrito)}</td></tr>` +
          `<tr><td style="padding:6px 0;color:#64748b">Fecha y horario:</td><td style="padding:6px 0;font-weight:600">${escapeHtml(fecha)} · ${escapeHtml(horaSalida)} – ${escapeHtml(horaRetorno)}</td></tr>` +
          `<tr><td style="padding:6px 0;color:#64748b">Motivo:</td><td style="padding:6px 0">${escapeHtml(motivoFinal)}</td></tr>` +
          `<tr><td style="padding:6px 0;color:#64748b">Contacto:</td><td style="padding:6px 0">${escapeHtml(contactoNombre)} (${escapeHtml(contactoCargo)}) · ${escapeHtml(contactoCelular)}</td></tr>` +
          `</table>` +
          `<p style="font-size:13px;color:#334155"><strong>Descripción:</strong> ${escapeHtml(descripcion)}</p>` +
          `<div style="margin-top:20px;display:flex;gap:12px">` +
          `<a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:11px 18px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;margin-right:10px">✓ Aceptar visita</a>` +
          `<a href="${escapeHtml(rejectUrl)}" style="display:inline-block;padding:11px 18px;background:#B91C1C;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">✕ Rechazar solicitud</a>` +
          `</div>` +
          `</div>`,
      });
    }

    const created = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({
      solicitud: parseSolicitudRow(created),
      whatsappTecnicoUrl: waUrl,
    });
  });

  router.post('/solicitudes/:id/responder', requireRoles(['tecnico', 'admin']), async (req, res) => {
    const profile = req.authCtx!.profile!;
    const id = String(req.params.id || '');
    const accion = String(req.body?.accion || '').toUpperCase();
    const observacion = String(req.body?.observacion || '').trim();

    if (accion !== 'ACEPTAR' && accion !== 'RECHAZAR') {
      res.status(400).json({ error: 'Acción inválida. Usa ACEPTAR o RECHAZAR.' });
      return;
    }

    const row = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Solicitud no encontrada.' });
      return;
    }

    const sol = parseSolicitudRow(row);
    if (profile.rol === 'tecnico' && sol.tecnico_id !== profile.id) {
      res.status(403).json({ error: 'Solo el técnico asignado o un administrador puede responder esta solicitud.' });
      return;
    }
    if (sol.estado !== 'PENDIENTE') {
      res.status(409).json({
        error: `Esta solicitud ya fue respondida previamente (${sol.estado}). No puede modificarse una vez cerrada.`,
      });
      return;
    }

    try {
      const result = await executeSolicitudResponse({
        sol,
        actorEmail: profile.email,
        actorNombre: profile.nombre,
        accion,
        observacion,
      });
      res.json(result);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.delete('/solicitudes/:id', requireRoles(['vendedor', 'admin']), (req, res) => {
    const profile = req.authCtx!.profile!;
    const id = String(req.params.id || '');
    const row = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Solicitud no encontrada.' });
      return;
    }

    const sol = parseSolicitudRow(row);
    if (profile.rol === 'vendedor') {
      if (sol.ejecutivo_email.toLowerCase() !== profile.email.toLowerCase()) {
        res.status(403).json({ error: 'Solo puedes eliminar solicitudes registradas por ti.' });
        return;
      }
      if (sol.estado !== 'PENDIENTE') {
        res.status(409).json({ error: 'No puedes eliminar una solicitud ya respondida.' });
        return;
      }
    }

    const repRow = db
      .prepare('SELECT imagenes_actividades, imagenes_recomendaciones, imagenes_pendientes FROM reportes WHERE solicitud_id = ?')
      .get(sol.id) as
      | {
          imagenes_actividades: string;
          imagenes_recomendaciones: string;
          imagenes_pendientes: string;
        }
      | undefined;

    const fileIdsToRemove: string[] = sol.imagenes.map((f) => f.id);
    if (repRow) {
      for (const col of [
        repRow.imagenes_actividades,
        repRow.imagenes_recomendaciones,
        repRow.imagenes_pendientes,
      ]) {
        for (const f of hydrateFileRefs(col)) {
          fileIdsToRemove.push(f.id);
        }
      }
    }

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM historial WHERE solicitud_id = ?').run(sol.id);
      db.prepare('DELETE FROM reportes WHERE solicitud_id = ?').run(sol.id);
      db.prepare('DELETE FROM solicitudes WHERE id = ?').run(sol.id);
      for (const fid of fileIdsToRemove) {
        safeUnlinkPrivateFile(fid);
      }
    });
    tx();

    res.json({ ok: true, deletedCodigo: sol.codigo });
  });

  // ---------------- REPORTES TÉCNICOS ----------------
  router.post('/solicitudes/:id/reporte', requireRoles(['tecnico', 'admin']), async (req, res) => {
    const profile = req.authCtx!.profile!;
    const solicitudId = String(req.params.id || '');
    const mode = String(req.body?.mode || 'BORRADOR').toUpperCase();

    const solRow = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(solicitudId) as
      | Record<string, unknown>
      | undefined;
    if (!solRow) {
      res.status(404).json({ error: 'Solicitud no encontrada.' });
      return;
    }

    const sol = parseSolicitudRow(solRow);
    if (profile.rol === 'tecnico' && sol.tecnico_id !== profile.id) {
      res.status(403).json({ error: 'Solo el técnico asignado o un administrador puede registrar el reporte.' });
      return;
    }
    if (sol.estado !== 'ACEPTADA') {
      res.status(409).json({ error: 'Solo se pueden completar reportes de visitas ACEPTADAS.' });
      return;
    }

    const actividadesRaw = Array.isArray(req.body?.actividades)
      ? req.body.actividades.map((a: unknown) => String(a || '').trim()).filter((a: string) => a.length > 0)
      : [];
    const recomendaciones = String(req.body?.recomendaciones || '').trim();
    const pendientes = String(req.body?.pendientes || '').trim();
    const fechaCulminacion = String(req.body?.fecha_culminacion || '').trim();
    const horaCulminacion = String(req.body?.hora_culminacion || '').trim();

    if (actividadesRaw.length === 0) {
      res.status(400).json({ error: 'Debes registrar al menos una actividad realizada.' });
      return;
    }
    if (!isValidDateYYYYMMDD(fechaCulminacion)) {
      res.status(400).json({ error: 'La fecha de culminación debe tener formato YYYY-MM-DD.' });
      return;
    }
    if (!isValidTimeHHMM(horaCulminacion)) {
      res.status(400).json({ error: 'La hora de culminación debe tener formato HH:MM.' });
      return;
    }

    const imgAct = validateImageIdList(req.body?.imagenes_actividades, 6);
    const imgRec = validateImageIdList(req.body?.imagenes_recomendaciones, 6);
    const imgPen = validateImageIdList(req.body?.imagenes_pendientes, 6);

    const now = new Date().toISOString();
    const existingRep = db
      .prepare('SELECT id FROM reportes WHERE solicitud_id = ?')
      .get(sol.id) as { id: string } | undefined;

    const reportId = existingRep ? existingRep.id : crypto.randomUUID();

    // Asociar archivos con la solicitud para RBAC
    for (const f of [...imgAct, ...imgRec, ...imgPen]) {
      db.prepare('UPDATE archivos SET entity_id = ? WHERE id = ?').run(sol.id, f.id);
    }

    const cfgRow = db.prepare('SELECT nombre_sistema FROM configuracion WHERE id = 1').get() as {
      nombre_sistema: string;
    };

    if (mode === 'ENVIAR') {
      // Generar PDF en el servidor
      const pdfBuffer = await generateVisitReportPdf({
        solicitud: sol,
        reporte: {
          actividades: actividadesRaw,
          recomendaciones,
          pendientes,
          imagenes_actividades: imgAct,
          imagenes_recomendaciones: imgRec,
          imagenes_pendientes: imgPen,
          fecha_culminacion: fechaCulminacion,
          hora_culminacion: horaCulminacion,
          autor_email: profile.email,
        },
        nombreSistema: cfgRow.nombre_sistema,
      });

      const adminEmails = (
        db
          .prepare("SELECT email FROM profiles WHERE rol = 'admin' AND activo = 1")
          .all() as Array<{ email: string }>
      ).map((r) => r.email);

      const destinatarios = Array.from(new Set([sol.ejecutivo_email, ...adminEmails]));

      const mailRes = await sendCorporateEmail({
        to: destinatarios,
        subject: `Reporte de Visita ${sol.codigo} — ${sol.cliente}`,
        text: `Estimados,\n\nSe adjunta el Informe Técnico en PDF correspondiente a la visita ${sol.codigo} (${sol.cliente}, ${sol.distrito}).\nTécnico: ${sol.tecnico_nombre}\nCulminación: ${fechaCulminacion} ${horaCulminacion}\n\nAtentamente,\n${cfgRow.nombre_sistema}`,
        attachments: [
          {
            filename: `Reporte-${sol.codigo}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      const tx = db.transaction(() => {
        if (existingRep) {
          db.prepare(
            `UPDATE reportes SET
              actividades = ?, recomendaciones = ?, pendientes = ?,
              imagenes_actividades = ?, imagenes_recomendaciones = ?, imagenes_pendientes = ?,
              fecha_culminacion = ?, hora_culminacion = ?, autor_email = ?,
              estado_envio = 'ENVIADO', email_enviado = ?, email_detalle = ?,
              email_destinatarios = ?, pdf_generado_at = ?, updated_at = ?
             WHERE id = ?`
          ).run(
            JSON.stringify(actividadesRaw),
            recomendaciones,
            pendientes,
            JSON.stringify(imgAct),
            JSON.stringify(imgRec),
            JSON.stringify(imgPen),
            fechaCulminacion,
            horaCulminacion,
            profile.email,
            mailRes.sent ? 1 : 0,
            mailRes.detail,
            JSON.stringify(destinatarios),
            now,
            now,
            reportId
          );
        } else {
          db.prepare(
            `INSERT INTO reportes (
              id, solicitud_id, codigo_visita, actividades, recomendaciones, pendientes,
              imagenes_actividades, imagenes_recomendaciones, imagenes_pendientes,
              fecha_culminacion, hora_culminacion, autor_email, estado_envio,
              email_enviado, email_detalle, email_destinatarios, pdf_generado_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ENVIADO', ?, ?, ?, ?, ?, ?)`
          ).run(
            reportId,
            sol.id,
            sol.codigo,
            JSON.stringify(actividadesRaw),
            recomendaciones,
            pendientes,
            JSON.stringify(imgAct),
            JSON.stringify(imgRec),
            JSON.stringify(imgPen),
            fechaCulminacion,
            horaCulminacion,
            profile.email,
            mailRes.sent ? 1 : 0,
            mailRes.detail,
            JSON.stringify(destinatarios),
            now,
            now,
            now
          );
        }

        db.prepare(
          `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
           VALUES (?, ?, ?, ?, ?, 'REPORTE_ENVIADO', 'ACEPTADA', 'ACEPTADA', ?, ?)`
        ).run(
          crypto.randomUUID(),
          sol.id,
          sol.codigo,
          profile.email,
          profile.nombre,
          `Reporte emitido con PDF generado en servidor. Estado correo: ${mailRes.sent ? 'Enviado' : 'No enviado (' + mailRes.detail + ')'}`,
          now
        );

        db.prepare(
          `INSERT INTO notificaciones (id, destinatario_email, titulo, mensaje, tipo, solicitud_codigo, leida, whatsapp_url, created_at)
           VALUES (?, ?, ?, ?, 'reporte', ?, 0, NULL, ?)`
        ).run(
          crypto.randomUUID(),
          sol.ejecutivo_email,
          `Reporte técnico emitido: ${sol.codigo}`,
          `${profile.nombre} completó el reporte de la visita a ${sol.cliente}. ${mailRes.sent ? 'PDF enviado por correo.' : 'PDF generado en servidor (correo pendiente de configuración SMTP).'}`,
          sol.codigo,
          now
        );
      });
      tx();

      const savedRep = db.prepare('SELECT * FROM reportes WHERE id = ?').get(reportId) as Record<string, unknown>;
      res.json({
        reporte: {
          ...savedRep,
          actividades: actividadesRaw,
          imagenes_actividades: hydrateFileRefs(String(savedRep.imagenes_actividades)),
          imagenes_recomendaciones: hydrateFileRefs(String(savedRep.imagenes_recomendaciones)),
          imagenes_pendientes: hydrateFileRefs(String(savedRep.imagenes_pendientes)),
          email_enviado: Number(savedRep.email_enviado) === 1,
          email_destinatarios: destinatarios,
        },
        pdfGenerated: true,
        emailSent: mailRes.sent,
        emailDetail: mailRes.detail,
      });
      return;
    }

    // Modo BORRADOR
    if (existingRep) {
      db.prepare(
        `UPDATE reportes SET
          actividades = ?, recomendaciones = ?, pendientes = ?,
          imagenes_actividades = ?, imagenes_recomendaciones = ?, imagenes_pendientes = ?,
          fecha_culminacion = ?, hora_culminacion = ?, autor_email = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        JSON.stringify(actividadesRaw),
        recomendaciones,
        pendientes,
        JSON.stringify(imgAct),
        JSON.stringify(imgRec),
        JSON.stringify(imgPen),
        fechaCulminacion,
        horaCulminacion,
        profile.email,
        now,
        reportId
      );
    } else {
      db.prepare(
        `INSERT INTO reportes (
          id, solicitud_id, codigo_visita, actividades, recomendaciones, pendientes,
          imagenes_actividades, imagenes_recomendaciones, imagenes_pendientes,
          fecha_culminacion, hora_culminacion, autor_email, estado_envio,
          email_enviado, email_detalle, email_destinatarios, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORRADOR', 0, '', '[]', ?, ?)`
      ).run(
        reportId,
        sol.id,
        sol.codigo,
        JSON.stringify(actividadesRaw),
        recomendaciones,
        pendientes,
        JSON.stringify(imgAct),
        JSON.stringify(imgRec),
        JSON.stringify(imgPen),
        fechaCulminacion,
        horaCulminacion,
        profile.email,
        now,
        now
      );
    }

    const savedDraft = db.prepare('SELECT * FROM reportes WHERE id = ?').get(reportId) as Record<string, unknown>;
    res.json({
      reporte: {
        ...savedDraft,
        actividades: actividadesRaw,
        imagenes_actividades: hydrateFileRefs(String(savedDraft.imagenes_actividades)),
        imagenes_recomendaciones: hydrateFileRefs(String(savedDraft.imagenes_recomendaciones)),
        imagenes_pendientes: hydrateFileRefs(String(savedDraft.imagenes_pendientes)),
        email_enviado: Number(savedDraft.email_enviado) === 1,
        email_destinatarios: [],
      },
      pdfGenerated: false,
      emailSent: false,
      emailDetail: 'Borrador guardado correctamente.',
    });
  });

  // ---------------- BLOQUEOS ----------------
  router.post('/bloqueos', requireRoles(['tecnico', 'admin']), (req, res) => {
    const profile = req.authCtx!.profile!;
    const fecha = String(req.body?.fecha || '').trim();
    const motivo = String(req.body?.motivo || '').trim();
    const targetTecnicoId =
      profile.rol === 'admin' && req.body?.tecnico_id
        ? String(req.body.tecnico_id).trim()
        : profile.id;

    if (!isValidDateYYYYMMDD(fecha)) {
      res.status(400).json({ error: 'Formato de fecha inválido (YYYY-MM-DD).' });
      return;
    }
    if (motivo.length < 5) {
      res.status(400).json({ error: 'Ingresa un motivo detallado para el bloqueo (mínimo 5 caracteres).' });
      return;
    }

    const tecRow = db
      .prepare("SELECT id, nombre FROM profiles WHERE id = ? AND rol = 'tecnico' AND activo = 1")
      .get(targetTecnicoId) as { id: string; nombre: string } | undefined;
    if (!tecRow) {
      res.status(400).json({ error: 'Técnico inválido o inactivo.' });
      return;
    }

    const existingDup = db
      .prepare('SELECT id FROM bloqueos WHERE tecnico_id = ? AND fecha = ?')
      .get(tecRow.id, fecha);
    if (existingDup) {
      res.status(409).json({ error: `Ya existe un bloqueo registrado para ${tecRow.nombre} en la fecha ${fecha}.` });
      return;
    }

    const acceptedOnDate = db
      .prepare("SELECT codigo, cliente FROM solicitudes WHERE tecnico_id = ? AND fecha = ? AND estado = 'ACEPTADA'")
      .all(tecRow.id, fecha) as Array<{ codigo: string; cliente: string }>;
    if (acceptedOnDate.length > 0) {
      const list = acceptedOnDate.map((v) => `${v.codigo} (${v.cliente})`).join(', ');
      res.status(409).json({
        error: `No se puede bloquear el ${fecha} porque el técnico tiene visitas aceptadas: ${list}.`,
      });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO bloqueos (id, tecnico_id, tecnico_nombre, fecha, motivo, created_by_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, tecRow.id, tecRow.nombre, fecha, motivo, profile.email, now);

    const created = db.prepare('SELECT * FROM bloqueos WHERE id = ?').get(id);
    res.status(201).json({ bloqueo: created });
  });

  router.delete('/bloqueos/:id', requireRoles(['tecnico', 'admin']), (req, res) => {
    const profile = req.authCtx!.profile!;
    const id = String(req.params.id || '');
    const row = db.prepare('SELECT * FROM bloqueos WHERE id = ?').get(id) as
      | { id: string; tecnico_id: string }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Bloqueo no encontrado.' });
      return;
    }
    if (profile.rol === 'tecnico' && row.tecnico_id !== profile.id) {
      res.status(403).json({ error: 'Solo puedes liberar bloqueos de tu propia agenda.' });
      return;
    }

    db.prepare('DELETE FROM bloqueos WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------------- NOTIFICACIONES ----------------
  router.post('/notificaciones/:id/leer', requireActiveProfile, (req, res) => {
    const profile = req.authCtx!.profile!;
    const id = String(req.params.id || '');
    db.prepare('UPDATE notificaciones SET leida = 1 WHERE id = ? AND LOWER(destinatario_email) = LOWER(?)').run(
      id,
      profile.email
    );
    res.json({ ok: true });
  });

  // ---------------- ADMIN: PERFILES, CLIENTES, CONFIG, AUDITORÍA ----------------
  router.get('/admin/perfiles', requireRoles(['admin']), (_req, res) => {
    const rows = db.prepare('SELECT * FROM profiles ORDER BY rol ASC, nombre ASC').all() as Array<Record<string, unknown>>;
    res.json({ perfiles: rows.map(parseProfileRow) });
  });

  router.post('/admin/perfiles', requireRoles(['admin']), (req, res) => {
    const admin = req.authCtx!.profile!;
    const email = normalizeCorporateEmail(String(req.body?.email || ''));
    const nombre = String(req.body?.nombre || '').trim();
    const rol = String(req.body?.rol || '') as UserRole;
    const celular = String(req.body?.celular || '').trim();
    const especialidad = String(req.body?.especialidad || '').trim();
    const activo = req.body?.activo !== false;
    const cartera = Array.isArray(req.body?.cartera_clientes)
      ? req.body.cartera_clientes.map((c: unknown) => String(c))
      : [];

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
      return;
    }
    if (!nombre || !['admin', 'vendedor', 'tecnico'].includes(rol)) {
      res.status(400).json({ error: 'Nombre y rol funcional válido son obligatorios.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM profiles WHERE LOWER(email) = ?').get(email);
    if (exists) {
      res.status(409).json({ error: 'Ya existe un perfil con ese correo electrónico.' });
      return;
    }

    const cfgShared = db
      .prepare('SELECT permitir_cliente_compartido FROM configuracion WHERE id = 1')
      .get() as { permitir_cliente_compartido: number } | undefined;
    const allowShared = Number(cfgShared?.permitir_cliente_compartido ?? 1) === 1;

    if (rol === 'vendedor' && cartera.length > 0 && !allowShared) {
      const otherVendors = (
        db.prepare("SELECT id, nombre, cartera_clientes FROM profiles WHERE rol = 'vendedor'").all() as Array<
          Record<string, unknown>
        >
      ).map(parseProfileRow);
      for (const clientName of cartera) {
        const conflict = otherVendors.find((ov) => ov.cartera_clientes.includes(clientName));
        if (conflict) {
          res.status(409).json({
            error: `La regla de cartera exclusiva está activa: "${clientName}" ya pertenece a ${conflict.nombre}.`,
          });
          return;
        }
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO profiles (id, email, nombre, rol, celular, especialidad, activo, cartera_clientes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, email, nombre, rol, celular, especialidad, activo ? 1 : 0, JSON.stringify(cartera), now, now);

    db.prepare(
      `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
       VALUES (?, NULL, 'SISTEMA', ?, ?, 'PERFIL_CREADO', NULL, ?, ?, ?)`
    ).run(crypto.randomUUID(), admin.email, admin.nombre, rol.toUpperCase(), `Perfil creado para ${nombre} (${email})`, now);

    const created = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ perfil: parseProfileRow(created) });
  });

  router.patch('/admin/perfiles/:id', requireRoles(['admin']), (req, res) => {
    const admin = req.authCtx!.profile!;
    const id = String(req.params.id || '');
    const existingRow = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) {
      res.status(404).json({ error: 'Perfil no encontrado.' });
      return;
    }

    const current = parseProfileRow(existingRow);
    const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : current.nombre;
    const rol = req.body?.rol !== undefined ? (String(req.body.rol) as UserRole) : current.rol;
    const celular = req.body?.celular !== undefined ? String(req.body.celular).trim() : current.celular;
    const especialidad =
      req.body?.especialidad !== undefined ? String(req.body.especialidad).trim() : current.especialidad;
    const activo = req.body?.activo !== undefined ? Boolean(req.body.activo) : current.activo;
    const cartera: string[] = Array.isArray(req.body?.cartera_clientes)
      ? Array.from(
          new Set<string>(
            (req.body.cartera_clientes as unknown[])
              .map((c) => String(c || '').trim())
              .filter(Boolean)
          )
        )
      : current.cartera_clientes;

    if (!nombre || !['admin', 'vendedor', 'tecnico'].includes(rol)) {
      res.status(400).json({ error: 'Datos de perfil inválidos.' });
      return;
    }

    if (current.id === admin.id && (!activo || rol !== 'admin')) {
      res.status(400).json({ error: 'No puedes desactivar tu propio perfil ni quitarte el rol de Administrador.' });
      return;
    }

    const cfgShared = db
      .prepare('SELECT permitir_cliente_compartido FROM configuracion WHERE id = 1')
      .get() as { permitir_cliente_compartido: number } | undefined;
    const allowShared = Number(cfgShared?.permitir_cliente_compartido ?? 1) === 1;

    if (rol === 'vendedor' && cartera.length > 0 && !allowShared) {
      const otherVendors = (
        db
          .prepare("SELECT id, nombre, cartera_clientes FROM profiles WHERE rol = 'vendedor' AND id != ?")
          .all(id) as Array<Record<string, unknown>>
      ).map(parseProfileRow);
      for (const clientName of cartera) {
        const conflict = otherVendors.find((ov) => ov.cartera_clientes.includes(clientName));
        if (conflict) {
          res.status(409).json({
            error: `La regla de cartera exclusiva está activa: "${clientName}" ya pertenece a ${conflict.nombre}.`,
          });
          return;
        }
      }
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE profiles
         SET nombre = ?, rol = ?, celular = ?, especialidad = ?, activo = ?, cartera_clientes = ?, updated_at = ?
         WHERE id = ?`
      ).run(nombre, rol, celular, especialidad, activo ? 1 : 0, JSON.stringify(cartera), now, id);

      const tipoAccion =
        current.rol !== rol
          ? 'CAMBIO_ROL'
          : current.activo !== activo
            ? 'ESTADO_PERFIL'
            : 'PERFIL_ACTUALIZADO';

      const changes: string[] = [];
      if (current.nombre !== nombre) changes.push(`Nombre: "${current.nombre}" → "${nombre}"`);
      if (current.rol !== rol) changes.push(`Rol: ${current.rol} → ${rol}`);
      if (current.activo !== activo) changes.push(`Estado: ${activo ? 'Activado' : 'Desactivado'}`);
      if (current.celular !== celular) changes.push(`Celular actualizado`);
      if (current.especialidad !== especialidad) changes.push(`Especialidad actualizada`);

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, NULL, 'SISTEMA', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        admin.email,
        admin.nombre,
        tipoAccion,
        `${current.rol.toUpperCase()} (${current.activo ? 'ACTIVO' : 'INACTIVO'})`,
        `${rol.toUpperCase()} (${activo ? 'ACTIVO' : 'INACTIVO'})`,
        `Actualización de perfil ${current.email}${changes.length ? ': ' + changes.join(' · ') : ''}`,
        now
      );
    });
    tx();

    const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ perfil: parseProfileRow(updated) });
  });

  router.post('/admin/perfiles/:id/reset-link', requireRoles(['admin']), (req, res) => {
    const id = String(req.params.id || '');
    const profileRow = db.prepare('SELECT email FROM profiles WHERE id = ?').get(id) as
      | { email: string }
      | undefined;
    if (!profileRow) {
      res.status(404).json({ error: 'Perfil no encontrado.' });
      return;
    }

    const userRow = db.prepare('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?)').get(profileRow.email) as
      | { id: string; email: string }
      | undefined;
    if (!userRow) {
      res.status(400).json({
        error: 'Este colaborador aún no ha registrado su contraseña en el portal. Debe usar "Registrarse" con su correo autorizado.',
      });
      return;
    }

    const rawToken = generateRandomToken(24);
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET reset_token_hash = ?, reset_expires = ? WHERE id = ?').run(
      hashToken(rawToken),
      expires,
      userRow.id
    );

    res.json({
      resetPath: `/reset-password?token=${encodeURIComponent(rawToken)}`,
      expiresAt: expires,
    });
  });

  router.delete('/admin/perfiles/:id', requireRoles(['admin']), (req, res) => {
    const admin = req.authCtx!.profile!;
    const id = String(req.params.id || '');
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Perfil no encontrado.' });
      return;
    }
    const target = parseProfileRow(row);
    if (target.id === admin.id) {
      res.status(400).json({ error: 'No puedes eliminar tu propio perfil administrador.' });
      return;
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      // Resolver solicitudes pendientes asociadas al perfil eliminado
      const pendingRelated = db
        .prepare(
          `SELECT id, codigo, ejecutivo_email FROM solicitudes
           WHERE estado = 'PENDIENTE' AND (tecnico_id = ? OR LOWER(ejecutivo_email) = LOWER(?))`
        )
        .all(target.id, target.email) as Array<{ id: string; codigo: string; ejecutivo_email: string }>;

      for (const p of pendingRelated) {
        const motivo = `Rechazada automáticamente por eliminación del perfil asociado (${target.nombre} - ${target.email}).`;
        db.prepare(
          `UPDATE solicitudes
           SET estado = 'RECHAZADA', respondido_por = ?, fecha_respuesta = ?, observacion = ?, updated_at = ?
           WHERE id = ?`
        ).run(admin.email, now, motivo, now, p.id);

        db.prepare(
          `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
           VALUES (?, ?, ?, ?, ?, 'RECHAZO_AUTOMATICO', 'PENDIENTE', 'RECHAZADA', ?, ?)`
        ).run(crypto.randomUUID(), p.id, p.codigo, admin.email, admin.nombre, motivo, now);
      }

      db.prepare('DELETE FROM bloqueos WHERE tecnico_id = ?').run(target.id);
      db.prepare('DELETE FROM users WHERE LOWER(email) = LOWER(?)').run(target.email);
      db.prepare('DELETE FROM profiles WHERE id = ?').run(target.id);

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, NULL, 'SISTEMA', ?, ?, 'PERFIL_ELIMINADO', ?, 'ELIMINADO', ?, ?)`
      ).run(
        crypto.randomUUID(),
        admin.email,
        admin.nombre,
        target.rol.toUpperCase(),
        `Perfil eliminado: ${target.nombre} (${target.email}). Solicitudes pendientes resueltas: ${pendingRelated.length}.`,
        now
      );
    });
    tx();

    res.json({ ok: true });
  });

  router.get('/admin/clientes', requireRoles(['admin']), (_req, res) => {
    const rows = db.prepare('SELECT id, nombre, ruc, sector, activo FROM clientes ORDER BY nombre ASC').all() as Array<{
      id: string;
      nombre: string;
      ruc: string;
      sector: string;
      activo: number;
    }>;
    res.json({ clientes: rows.map((r) => ({ ...r, activo: r.activo === 1 })) });
  });

  router.post('/admin/clientes', requireRoles(['admin']), (req, res) => {
    const nombre = String(req.body?.nombre || '').trim();
    const ruc = String(req.body?.ruc || '').trim();
    const sector = String(req.body?.sector || '').trim();
    if (!nombre) {
      res.status(400).json({ error: 'La razón social del cliente es obligatoria.' });
      return;
    }
    const exists = db.prepare('SELECT id FROM clientes WHERE LOWER(nombre) = LOWER(?)').get(nombre);
    if (exists) {
      res.status(409).json({ error: 'Ya existe un cliente registrado con ese nombre.' });
      return;
    }
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO clientes (id, nombre, ruc, sector, activo) VALUES (?, ?, ?, ?, 1)').run(
      id,
      nombre,
      ruc,
      sector
    );
    res.status(201).json({ cliente: { id, nombre, ruc, sector, activo: true } });
  });

  router.patch('/admin/clientes/:id', requireRoles(['admin']), (req, res) => {
    const id = String(req.params.id || '');
    const row = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as
      | { id: string; nombre: string; ruc: string; sector: string; activo: number }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Cliente no encontrado.' });
      return;
    }
    const activo = req.body?.activo !== undefined ? (req.body.activo ? 1 : 0) : row.activo;
    const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : row.nombre;
    const sector = req.body?.sector !== undefined ? String(req.body.sector).trim() : row.sector;
    db.prepare('UPDATE clientes SET nombre = ?, sector = ?, activo = ? WHERE id = ?').run(
      nombre,
      sector,
      activo,
      id
    );
    res.json({ cliente: { id, nombre, ruc: row.ruc, sector, activo: activo === 1 } });
  });

  router.post('/admin/carteras', requireRoles(['admin']), (req, res) => {
    const admin = req.authCtx!.profile!;
    const ejecutivoId = String(req.body?.ejecutivo_id || '').trim();
    const rawClientes = Array.isArray(req.body?.clientes) ? req.body.clientes : null;

    if (!ejecutivoId || !rawClientes) {
      res.status(400).json({ error: 'Debes indicar el ejecutivo comercial y la lista de clientes.' });
      return;
    }

    const execRow = db.prepare('SELECT * FROM profiles WHERE id = ?').get(ejecutivoId) as
      | Record<string, unknown>
      | undefined;
    if (!execRow) {
      res.status(404).json({ error: 'Ejecutivo comercial no encontrado.' });
      return;
    }
    const execProfile = parseProfileRow(execRow);
    if (execProfile.rol !== 'vendedor') {
      res.status(400).json({ error: 'Solo los perfiles con rol Ejecutivo de ventas gestionan cartera de clientes.' });
      return;
    }

    const uniqueNames: string[] = Array.from(
      new Set<string>(
        (rawClientes as unknown[]).map((c) => String(c || '').trim()).filter(Boolean)
      )
    );

    // Validar que cada cliente exista en la tabla clientes
    const allClients = db.prepare('SELECT nombre FROM clientes').all() as Array<{ nombre: string }>;
    const validClientMap = new Map(allClients.map((c) => [c.nombre, c.nombre]));
    for (const name of uniqueNames) {
      if (!validClientMap.has(name)) {
        res.status(400).json({ error: `El cliente "${name}" no existe en el catálogo oficial de MIPERSA.` });
        return;
      }
    }

    // Validar regla de cliente compartido
    const cfgShared = db
      .prepare('SELECT permitir_cliente_compartido FROM configuracion WHERE id = 1')
      .get() as { permitir_cliente_compartido: number } | undefined;
    const allowShared = Number(cfgShared?.permitir_cliente_compartido ?? 1) === 1;

    if (!allowShared && uniqueNames.length > 0) {
      const otherVendors = (
        db
          .prepare("SELECT id, nombre, cartera_clientes FROM profiles WHERE rol = 'vendedor' AND id != ?")
          .all(execProfile.id) as Array<Record<string, unknown>>
      ).map(parseProfileRow);
      for (const clientName of uniqueNames) {
        const conflict = otherVendors.find((ov) => ov.cartera_clientes.includes(clientName));
        if (conflict) {
          res.status(409).json({
            error: `La regla actual no permite clientes compartidos: "${clientName}" ya está asignado a ${conflict.nombre}.`,
          });
          return;
        }
      }
    }

    const prevSet = new Set(execProfile.cartera_clientes);
    const nextSet = new Set(uniqueNames);
    const added = uniqueNames.filter((n) => !prevSet.has(n));
    const removed = execProfile.cartera_clientes.filter((n) => !nextSet.has(n));

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('UPDATE profiles SET cartera_clientes = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(uniqueNames),
        now,
        execProfile.id
      );

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, NULL, 'SISTEMA', ?, ?, 'CARTERA_ACTUALIZADA', ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        admin.email,
        admin.nombre,
        `${prevSet.size} clientes`,
        `${uniqueNames.length} clientes`,
        `Cartera de ${execProfile.nombre} actualizada (+${added.length} asignados, -${removed.length} retirados).`,
        now
      );
    });
    tx();

    const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(execProfile.id) as Record<string, unknown>;
    res.json({
      perfil: parseProfileRow(updated),
      addedCount: added.length,
      removedCount: removed.length,
    });
  });

  router.get('/admin/distritos', requireRoles(['admin']), (_req, res) => {
    const rows = db
      .prepare('SELECT id, nombre, provincia, departamento, activo FROM distritos ORDER BY nombre ASC')
      .all() as Array<{
      id: string;
      nombre: string;
      provincia: string;
      departamento: string;
      activo: number;
    }>;
    res.json({ distritos: rows.map((r) => ({ ...r, activo: Number(r.activo) === 1 })) });
  });

  router.post('/admin/distritos', requireRoles(['admin']), (req, res) => {
    const admin = req.authCtx!.profile!;
    const nombre = String(req.body?.nombre || '').trim().toUpperCase();
    const provincia = String(req.body?.provincia || 'Lima').trim() || 'Lima';
    const departamento = String(req.body?.departamento || 'Lima').trim() || 'Lima';
    const activo = req.body?.activo !== false;

    if (!nombre) {
      res.status(400).json({ error: 'El nombre del distrito es obligatorio.' });
      return;
    }

    const normNew = normalizeCatalogKey(nombre);
    const existingAll = db.prepare('SELECT id, nombre FROM distritos').all() as Array<{
      id: string;
      nombre: string;
    }>;
    const dup = existingAll.find((d) => normalizeCatalogKey(d.nombre) === normNew);
    if (dup) {
      res.status(409).json({
        error: `Ya existe un distrito equivalente en el catálogo: "${dup.nombre}".`,
      });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO distritos (id, nombre, provincia, departamento, activo) VALUES (?, ?, ?, ?, ?)'
      ).run(id, nombre, provincia, departamento, activo ? 1 : 0);

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, NULL, 'SISTEMA', ?, ?, 'DISTRITO_CREADO', NULL, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        admin.email,
        admin.nombre,
        activo ? 'ACTIVO' : 'INACTIVO',
        `Distrito agregado: ${nombre} (${provincia}, ${departamento}).`,
        now
      );
    });
    tx();

    res.status(201).json({
      distrito: { id, nombre, provincia, departamento, activo },
    });
  });

  router.patch('/admin/distritos/:id', requireRoles(['admin']), (req, res) => {
    const admin = req.authCtx!.profile!;
    const id = String(req.params.id || '');
    const row = db
      .prepare('SELECT id, nombre, provincia, departamento, activo FROM distritos WHERE id = ?')
      .get(id) as
      | { id: string; nombre: string; provincia: string; departamento: string; activo: number }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Distrito no encontrado.' });
      return;
    }

    const nombre =
      req.body?.nombre !== undefined ? String(req.body.nombre).trim().toUpperCase() : row.nombre;
    const provincia =
      req.body?.provincia !== undefined ? String(req.body.provincia).trim() : row.provincia;
    const departamento =
      req.body?.departamento !== undefined ? String(req.body.departamento).trim() : row.departamento;
    const activo =
      req.body?.activo !== undefined ? (req.body.activo ? 1 : 0) : row.activo;

    if (!nombre || !provincia || !departamento) {
      res.status(400).json({ error: 'Nombre, provincia y departamento son obligatorios.' });
      return;
    }

    const normNew = normalizeCatalogKey(nombre);
    const others = db.prepare('SELECT id, nombre FROM distritos WHERE id != ?').all(id) as Array<{
      id: string;
      nombre: string;
    }>;
    const dup = others.find((d) => normalizeCatalogKey(d.nombre) === normNew);
    if (dup) {
      res.status(409).json({
        error: `Ya existe otro distrito equivalente en el catálogo: "${dup.nombre}".`,
      });
      return;
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        'UPDATE distritos SET nombre = ?, provincia = ?, departamento = ?, activo = ? WHERE id = ?'
      ).run(nombre, provincia, departamento, activo, id);

      db.prepare(
        `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
         VALUES (?, NULL, 'SISTEMA', ?, ?, 'DISTRITO_ACTUALIZADO', ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        admin.email,
        admin.nombre,
        `${row.nombre} (${row.activo === 1 ? 'ACTIVO' : 'INACTIVO'})`,
        `${nombre} (${activo === 1 ? 'ACTIVO' : 'INACTIVO'})`,
        `Catálogo de distrito actualizado: ${nombre} (${provincia}, ${departamento}).`,
        now
      );
    });
    tx();

    res.json({
      distrito: { id, nombre, provincia, departamento, activo: activo === 1 },
    });
  });

  router.patch('/admin/configuracion', requireRoles(['admin']), (req, res) => {
    const admin = req.authCtx!.profile!;
    const nombreSistema = String(req.body?.nombre_sistema || '').trim();
    const margenMinutos = Number(req.body?.margen_minutos);

    if (!nombreSistema) {
      res.status(400).json({ error: 'El nombre del sistema no puede estar vacío.' });
      return;
    }
    if (!Number.isInteger(margenMinutos) || margenMinutos < 0 || margenMinutos > 480) {
      res.status(400).json({ error: 'El margen entre visitas debe ser un entero entre 0 y 480 minutos.' });
      return;
    }

    const currentCfg = db
      .prepare('SELECT permitir_cliente_compartido FROM configuracion WHERE id = 1')
      .get() as { permitir_cliente_compartido?: number } | undefined;

    const permitirCompartido =
      req.body?.permitir_cliente_compartido !== undefined
        ? req.body.permitir_cliente_compartido
          ? 1
          : 0
        : Number(currentCfg?.permitir_cliente_compartido ?? 1);

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE configuracion SET nombre_sistema = ?, margen_minutos = ?, permitir_cliente_compartido = ?, updated_at = ? WHERE id = 1'
    ).run(nombreSistema, margenMinutos, permitirCompartido, now);

    db.prepare(
      `INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
       VALUES (?, NULL, 'SISTEMA', ?, ?, 'CONFIGURACION', NULL, NULL, ?, ?)`
    ).run(
      crypto.randomUUID(),
      admin.email,
      admin.nombre,
      `Parámetros actualizados: Sistema="${nombreSistema}", Margen=${margenMinutos} min, Clientes compartidos=${permitirCompartido === 1 ? 'Permitido' : 'Exclusivo por ejecutivo'}.`,
      now
    );

    const cfg = db.prepare('SELECT * FROM configuracion WHERE id = 1').get() as {
      id: number;
      nombre_sistema: string;
      margen_minutos: number;
      permitir_cliente_compartido: number;
      updated_at: string;
    };
    res.json({
      configuracion: {
        ...cfg,
        permitir_cliente_compartido: Number(cfg.permitir_cliente_compartido) === 1,
      },
    });
  });

  router.get('/auditoria', requireRoles(['admin']), (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM historial ORDER BY fecha_registro DESC LIMIT 500')
      .all();
    res.json({ historial: rows });
  });

  return router;
}
