import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  OFFICIAL_ADMINS,
  OFFICIAL_DISTRICTS,
  OFFICIAL_TECNICOS,
  OFFICIAL_VENDORS_AND_CLIENTS,
} from './officialCatalog.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOAD_DIR = path.resolve(process.cwd(), 'private_uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'mipersa.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS configuracion (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nombre_sistema TEXT NOT NULL DEFAULT 'Gestor de Visitas MIPERSA',
      margen_minutos INTEGER NOT NULL DEFAULT 60,
      permitir_cliente_compartido INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('admin', 'vendedor', 'tecnico')),
      celular TEXT NOT NULL DEFAULT '',
      especialidad TEXT NOT NULL DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1,
      cartera_clientes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token_hash TEXT,
      verification_expires TEXT,
      reset_token_hash TEXT,
      reset_expires TEXT,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      mfa_secret TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      ruc TEXT NOT NULL DEFAULT '',
      sector TEXT NOT NULL DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS distritos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      provincia TEXT NOT NULL DEFAULT 'Lima',
      departamento TEXT NOT NULL DEFAULT 'Lima',
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS solicitudes (
      id TEXT PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      ejecutivo_email TEXT NOT NULL,
      ejecutivo_nombre TEXT NOT NULL,
      cliente TEXT NOT NULL,
      distrito TEXT NOT NULL,
      fecha TEXT NOT NULL,
      hora_salida TEXT NOT NULL,
      hora_retorno TEXT NOT NULL,
      motivo TEXT NOT NULL,
      motivo_otro TEXT NOT NULL DEFAULT '',
      tecnico_id TEXT NOT NULL,
      tecnico_nombre TEXT NOT NULL,
      contacto_nombre TEXT NOT NULL,
      contacto_cargo TEXT NOT NULL,
      contacto_celular TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      imagenes TEXT NOT NULL DEFAULT '[]',
      estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA')) DEFAULT 'PENDIENTE',
      respondido_por TEXT,
      fecha_respuesta TEXT,
      observacion TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reportes (
      id TEXT PRIMARY KEY,
      solicitud_id TEXT NOT NULL UNIQUE,
      codigo_visita TEXT NOT NULL,
      actividades TEXT NOT NULL DEFAULT '[]',
      recomendaciones TEXT NOT NULL DEFAULT '',
      pendientes TEXT NOT NULL DEFAULT '',
      imagenes_actividades TEXT NOT NULL DEFAULT '[]',
      imagenes_recomendaciones TEXT NOT NULL DEFAULT '[]',
      imagenes_pendientes TEXT NOT NULL DEFAULT '[]',
      fecha_culminacion TEXT NOT NULL,
      hora_culminacion TEXT NOT NULL,
      autor_email TEXT NOT NULL,
      estado_envio TEXT NOT NULL CHECK (estado_envio IN ('BORRADOR', 'ENVIADO')) DEFAULT 'BORRADOR',
      email_enviado INTEGER NOT NULL DEFAULT 0,
      email_detalle TEXT NOT NULL DEFAULT '',
      email_destinatarios TEXT NOT NULL DEFAULT '[]',
      pdf_generado_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bloqueos (
      id TEXT PRIMARY KEY,
      tecnico_id TEXT NOT NULL,
      tecnico_nombre TEXT NOT NULL,
      fecha TEXT NOT NULL,
      motivo TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (tecnico_id, fecha)
    );

    CREATE TABLE IF NOT EXISTS historial (
      id TEXT PRIMARY KEY,
      solicitud_id TEXT,
      codigo_visita TEXT NOT NULL,
      usuario_email TEXT NOT NULL,
      usuario_nombre TEXT NOT NULL,
      tipo_accion TEXT NOT NULL,
      estado_anterior TEXT,
      estado_nuevo TEXT,
      detalle TEXT NOT NULL,
      fecha_registro TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS archivos (
      id TEXT PRIMARY KEY,
      storage_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      owner_email TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notificaciones (
      id TEXT PRIMARY KEY,
      destinatario_email TEXT NOT NULL,
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      tipo TEXT NOT NULL,
      solicitud_codigo TEXT,
      leida INTEGER NOT NULL DEFAULT 0,
      whatsapp_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_solicitudes_tecnico_fecha ON solicitudes(tecnico_id, fecha);
    CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes(estado);
    CREATE INDEX IF NOT EXISTS idx_bloqueos_tecnico_fecha ON bloqueos(tecnico_id, fecha);
    CREATE INDEX IF NOT EXISTS idx_historial_solicitud ON historial(solicitud_id);
    CREATE INDEX IF NOT EXISTS idx_notificaciones_dest ON notificaciones(destinatario_email, leida);
  `);

  // Safe migrations for existing DBs
  ensureColumn('configuracion', 'permitir_cliente_compartido', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('distritos', 'activo', 'INTEGER NOT NULL DEFAULT 1');

  seedInitialData();
  syncOfficialMipersaCatalog();
  syncOfficialSpecUsers();
}

function addDaysISO(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function seedInitialData(): void {
  const now = new Date().toISOString();

  const cfg = db.prepare('SELECT id FROM configuracion WHERE id = 1').get();
  if (!cfg) {
    db.prepare(
      'INSERT INTO configuracion (id, nombre_sistema, margen_minutos, permitir_cliente_compartido, updated_at) VALUES (1, ?, ?, 1, ?)'
    ).run('Gestor de Visitas MIPERSA', 60, now);
  }

  // Perfiles base oficiales (2 Administradores y 2 Asesores Técnicos) si no hay perfiles aún
  const profileCount = (db.prepare('SELECT COUNT(*) as c FROM profiles').get() as { c: number }).c;
  if (profileCount === 0) {
    const insertProfile = db.prepare(`
      INSERT INTO profiles (id, email, nombre, rol, celular, especialidad, activo, cartera_clientes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, '[]', ?, ?)
    `);

    for (const adm of OFFICIAL_ADMINS) {
      insertProfile.run(
        crypto.randomUUID(),
        adm.email.toLowerCase(),
        adm.nombre,
        'admin',
        adm.celular,
        adm.especialidad,
        now,
        now
      );
    }
    for (const tec of OFFICIAL_TECNICOS) {
      insertProfile.run(
        crypto.randomUUID(),
        tec.email.toLowerCase(),
        tec.nombre,
        'tecnico',
        tec.celular,
        tec.especialidad,
        now,
        now
      );
    }
  }
}

function syncOfficialMipersaCatalog(): void {
  const CATALOG_VERSION = 'mipersa_pdf_catalog_v1';
  const applied = db
    .prepare('SELECT value FROM catalog_meta WHERE key = ?')
    .get('catalog_version') as { value: string } | undefined;

  if (applied?.value === CATALOG_VERSION) {
    return;
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // 1. Reemplazar catálogo inicial de distritos genéricos por los 50 distritos oficiales del PDF (manteniendo historial intacto)
    db.prepare('DELETE FROM distritos').run();
    const insertDist = db.prepare(
      'INSERT INTO distritos (id, nombre, provincia, departamento, activo) VALUES (?, ?, ?, ?, 1)'
    );
    for (const d of OFFICIAL_DISTRICTS) {
      insertDist.run(crypto.randomUUID(), d.nombre, d.provincia, d.departamento);
    }

    // 2. Limpiar clientes genéricos previos (sin borrar solicitudes históricas) e insertar todos los clientes oficiales del PDF
    db.prepare('DELETE FROM clientes').run();
    const uniqueClients = new Set<string>();
    for (const vendor of OFFICIAL_VENDORS_AND_CLIENTS) {
      for (const clientName of vendor.clientes) {
        uniqueClients.add(clientName);
      }
    }
    const insertCliente = db.prepare(
      'INSERT INTO clientes (id, nombre, ruc, sector, activo) VALUES (?, ?, ?, ?, 1)'
    );
    for (const nombre of uniqueClients) {
      insertCliente.run(crypto.randomUUID(), nombre, '', 'Cartera MIPERSA');
    }

    // 3. Eliminar perfiles vendedores placeholder antiguos si no tienen usuario registrado en users
    for (const oldEmail of ['valeria.torres@mipersa.pe', 'rodrigo.salazar@mipersa.pe']) {
      const hasUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(oldEmail);
      if (!hasUser) {
        db.prepare('DELETE FROM profiles WHERE LOWER(email) = ?').run(oldEmail);
      }
    }

    // 4. Insertar o actualizar los 6 vendedores oficiales del PDF con sus carteras exactas
    const insertVendor = db.prepare(`
      INSERT INTO profiles (id, email, nombre, rol, celular, especialidad, activo, cartera_clientes, created_at, updated_at)
      VALUES (?, ?, ?, 'vendedor', ?, ?, 1, ?, ?, ?)
    `);
    const updateVendorCartera = db.prepare(`
      UPDATE profiles SET nombre = ?, cartera_clientes = ?, updated_at = ? WHERE LOWER(email) = ?
    `);

    for (const v of OFFICIAL_VENDORS_AND_CLIENTS) {
      const exists = db.prepare('SELECT id FROM profiles WHERE LOWER(email) = ?').get(v.email.toLowerCase());
      if (exists) {
        updateVendorCartera.run(v.nombre, JSON.stringify(v.clientes), now, v.email.toLowerCase());
      } else {
        insertVendor.run(
          crypto.randomUUID(),
          v.email.toLowerCase(),
          v.nombre,
          v.celular,
          v.especialidad,
          JSON.stringify(v.clientes),
          now,
          now
        );
      }
    }

    // 5. Actualizar o sembrar solicitudes de ejemplo usando clientes, distritos y vendedores oficiales del PDF
    const solCount = (db.prepare('SELECT COUNT(*) as c FROM solicitudes').get() as { c: number }).c;
    const tecnicos = db
      .prepare("SELECT id, nombre, email FROM profiles WHERE rol = 'tecnico' AND activo = 1 ORDER BY nombre ASC")
      .all() as Array<{ id: string; nombre: string; email: string }>;

    if (solCount === 0 && tecnicos.length >= 3) {
      const today = addDaysISO(0);
      const tomorrow = addDaysISO(1);
      const dayAfter = addDaysISO(2);
      const yesterday = addDaysISO(-1);

      const sol1Id = crypto.randomUUID();
      const sol2Id = crypto.randomUUID();
      const sol3Id = crypto.randomUUID();
      const sol4Id = crypto.randomUUID();

      const insertSol = db.prepare(`
        INSERT INTO solicitudes (
          id, codigo, ejecutivo_email, ejecutivo_nombre, cliente, distrito, fecha,
          hora_salida, hora_retorno, motivo, motivo_otro, tecnico_id, tecnico_nombre,
          contacto_nombre, contacto_cargo, contacto_celular, descripcion, imagenes,
          estado, respondido_por, fecha_respuesta, observacion, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)
      `);

      insertSol.run(
        sol1Id, 'VIS-0001', 'cristhian.jacinto@mipersa.pe', 'CRISTHIAN JACINTO',
        'MOTORES DIESEL ANDINOS S.A.- MODASA', 'LURÍN', yesterday, '09:00', '11:30',
        'Inspección técnica en planta', '', tecnicos[0].id, tecnicos[0].nombre,
        'Marcos Delgado', 'Jefe de Mantenimiento', '984512369',
        'Evaluación de banco hidráulico de pruebas y levantamiento de requerimientos de válvulas proporcionales.',
        'ACEPTADA', tecnicos[0].email, now,
        'Confirmado. Llevar manómetros calibrados y kit de sellos.', now, now
      );

      insertSol.run(
        sol2Id, 'VIS-0002', 'jofer.lopez@mipersa.pe', 'JOFER LOPEZ',
        'FUNDICION CALLAO S A', 'CALLAO', today, '10:00', '12:00',
        'Soporte post-venta', '', tecnicos[1].id, tecnicos[1].nombre,
        'Lucía Fernández', 'Supervisora de Automatización', '975623148',
        'Calibración de sensores de caudal en línea de producción y validación de lazos PLC.',
        'ACEPTADA', tecnicos[1].email, now,
        'Agenda confirmada con equipo de planta.', now, now
      );

      insertSol.run(
        sol3Id, 'VIS-0003', 'jaime.leon@mipersa.pe', 'JAIME LEON',
        'CORPORACION ACEROS AREQUIPA S.A.', 'CALLAO', tomorrow, '08:30', '11:00',
        'Levantamiento de información', '', tecnicos[0].id, tecnicos[0].nombre,
        'Ernesto Palacios', 'Superintendente Mecánico', '963258741',
        'Levantamiento dimensional en faja transportadora principal para reemplazo de acoplamientos hidráulicos.',
        'PENDIENTE', null, null, '', now, now
      );

      insertSol.run(
        sol4Id, 'VIS-0004', 'daniel.mesones@mipersa.pe', 'DANIEL MESONES',
        'STRACON PERÚ S.A.', 'SANTIAGO DE SURCO', tomorrow, '14:00', '16:30',
        'Presentación técnica de equipos', '', tecnicos[2].id, tecnicos[2].nombre,
        'Ricardo Benavides', 'Gerente de Confiabilidad', '951753852',
        'Demostración de analizador de vibraciones y termografía aplicada a sistemas de potencia.',
        'PENDIENTE', null, null, '', now, now
      );

      db.prepare(`
        INSERT OR IGNORE INTO bloqueos (id, tecnico_id, tecnico_nombre, fecha, motivo, created_by_email, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        tecnicos[1].id,
        tecnicos[1].nombre,
        dayAfter,
        'Capacitación técnica anual de certificación en seguridad eléctrica industrial.',
        tecnicos[1].email,
        now
      );

      const insertHist = db.prepare(`
        INSERT INTO historial (id, solicitud_id, codigo_visita, usuario_email, usuario_nombre, tipo_accion, estado_anterior, estado_nuevo, detalle, fecha_registro)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertHist.run(crypto.randomUUID(), sol1Id, 'VIS-0001', 'cristhian.jacinto@mipersa.pe', 'CRISTHIAN JACINTO', 'CREACION', null, 'PENDIENTE', 'Solicitud registrada para MOTORES DIESEL ANDINOS S.A.- MODASA', now);
      insertHist.run(crypto.randomUUID(), sol1Id, 'VIS-0001', tecnicos[0].email, tecnicos[0].nombre, 'ACEPTACION', 'PENDIENTE', 'ACEPTADA', 'Confirmado. Llevar manómetros calibrados y kit de sellos.', now);
      insertHist.run(crypto.randomUUID(), sol2Id, 'VIS-0002', 'jofer.lopez@mipersa.pe', 'JOFER LOPEZ', 'CREACION', null, 'PENDIENTE', 'Solicitud registrada para FUNDICION CALLAO S A', now);
      insertHist.run(crypto.randomUUID(), sol2Id, 'VIS-0002', tecnicos[1].email, tecnicos[1].nombre, 'ACEPTACION', 'PENDIENTE', 'ACEPTADA', 'Agenda confirmada con equipo de planta.', now);
      insertHist.run(crypto.randomUUID(), sol3Id, 'VIS-0003', 'jaime.leon@mipersa.pe', 'JAIME LEON', 'CREACION', null, 'PENDIENTE', 'Solicitud registrada para CORPORACION ACEROS AREQUIPA S.A.', now);
      insertHist.run(crypto.randomUUID(), sol4Id, 'VIS-0004', 'daniel.mesones@mipersa.pe', 'DANIEL MESONES', 'CREACION', null, 'PENDIENTE', 'Solicitud registrada para STRACON PERÚ S.A.', now);
    } else {
      // Actualizar las solicitudes de muestra existentes de Turn 1 si pertenecían a los vendedores dummy eliminados
      db.prepare(`UPDATE solicitudes SET ejecutivo_email = 'cristhian.jacinto@mipersa.pe', ejecutivo_nombre = 'CRISTHIAN JACINTO', cliente = 'MOTORES DIESEL ANDINOS S.A.- MODASA', distrito = 'LURÍN' WHERE ejecutivo_email = 'valeria.torres@mipersa.pe' AND codigo = 'VIS-0001'`).run();
      db.prepare(`UPDATE solicitudes SET ejecutivo_email = 'jofer.lopez@mipersa.pe', ejecutivo_nombre = 'JOFER LOPEZ', cliente = 'FUNDICION CALLAO S A', distrito = 'CALLAO' WHERE ejecutivo_email = 'rodrigo.salazar@mipersa.pe' AND codigo = 'VIS-0002'`).run();
      db.prepare(`UPDATE solicitudes SET ejecutivo_email = 'cristhian.jacinto@mipersa.pe', ejecutivo_nombre = 'CRISTHIAN JACINTO', cliente = 'RESEMIN S.A.', distrito = 'ATE' WHERE ejecutivo_email = 'valeria.torres@mipersa.pe' AND codigo = 'VIS-0003'`).run();
      db.prepare(`UPDATE solicitudes SET ejecutivo_email = 'daniel.mesones@mipersa.pe', ejecutivo_nombre = 'DANIEL MESONES', cliente = 'STRACON PERÚ S.A.', distrito = 'SANTIAGO DE SURCO' WHERE ejecutivo_email = 'rodrigo.salazar@mipersa.pe' AND codigo = 'VIS-0004'`).run();
    }

    db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)').run(
      'catalog_version',
      CATALOG_VERSION
    );
  });

  tx();
}

function syncOfficialSpecUsers(): void {
  const SPEC_VERSION = 'mipersa_spec_users_v2';
  const applied = db
    .prepare('SELECT value FROM catalog_meta WHERE key = ?')
    .get('spec_users_version') as { value: string } | undefined;

  if (applied?.value === SPEC_VERSION) {
    return;
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // 1. Eliminar perfiles placeholder antiguos si no tienen credenciales registradas en users
    for (const oldEmail of [
      'admin@mipersa.pe',
      'jorge.huaman@mipersa.pe',
      'andrea.ccahua@mipersa.pe',
      'luis.villanueva@mipersa.pe',
    ]) {
      const hasUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(oldEmail);
      if (!hasUser) {
        db.prepare('DELETE FROM profiles WHERE LOWER(email) = ?').run(oldEmail);
      }
    }

    // 2. Actualizar/insertar los 6 vendedores oficiales con sus números de WhatsApp exactos
    for (const v of OFFICIAL_VENDORS_AND_CLIENTS) {
      const email = v.email.toLowerCase();
      const existing = db.prepare('SELECT id FROM profiles WHERE LOWER(email) = ?').get(email) as
        | { id: string }
        | undefined;
      if (existing) {
        db.prepare(
          `UPDATE profiles
           SET nombre = ?, celular = ?, rol = 'vendedor', activo = 1, cartera_clientes = ?, updated_at = ?
           WHERE id = ?`
        ).run(v.nombre, v.celular, JSON.stringify(v.clientes), now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO profiles (id, email, nombre, rol, celular, especialidad, activo, cartera_clientes, created_at, updated_at)
           VALUES (?, ?, ?, 'vendedor', ?, ?, 1, ?, ?, ?)`
        ).run(crypto.randomUUID(), email, v.nombre, v.celular, v.especialidad, JSON.stringify(v.clientes), now, now);
      }
    }

    // 3. Actualizar/insertar los 2 Asesores Técnicos oficiales
    for (const tec of OFFICIAL_TECNICOS) {
      const email = tec.email.toLowerCase();
      const existing = db.prepare('SELECT id FROM profiles WHERE LOWER(email) = ?').get(email) as
        | { id: string }
        | undefined;
      if (existing) {
        db.prepare(
          `UPDATE profiles
           SET nombre = ?, rol = 'tecnico', celular = ?, especialidad = ?, activo = 1, updated_at = ?
           WHERE id = ?`
        ).run(tec.nombre, tec.celular, tec.especialidad, now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO profiles (id, email, nombre, rol, celular, especialidad, activo, cartera_clientes, created_at, updated_at)
           VALUES (?, ?, ?, 'tecnico', ?, ?, 1, '[]', ?, ?)`
        ).run(crypto.randomUUID(), email, tec.nombre, tec.celular, tec.especialidad, now, now);
      }
    }

    // 4. Actualizar/insertar los 2 Administradores oficiales (preservando cuenta existente de Piero)
    for (const adm of OFFICIAL_ADMINS) {
      const email = adm.email.toLowerCase();
      const existing = db.prepare('SELECT id, celular FROM profiles WHERE LOWER(email) = ?').get(email) as
        | { id: string; celular: string }
        | undefined;
      if (existing) {
        const nextCelular = existing.celular && existing.celular.trim() ? existing.celular : adm.celular;
        db.prepare(
          `UPDATE profiles
           SET rol = 'admin', celular = ?, activo = 1, updated_at = ?
           WHERE id = ?`
        ).run(nextCelular, now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO profiles (id, email, nombre, rol, celular, especialidad, activo, cartera_clientes, created_at, updated_at)
           VALUES (?, ?, ?, 'admin', ?, ?, 1, '[]', ?, ?)`
        ).run(crypto.randomUUID(), email, adm.nombre, adm.celular, adm.especialidad, now, now);
      }
    }

    // 5. Reasignar solicitudes o bloqueos huérfanos de técnicos placeholder eliminados hacia técnicos oficiales
    const activeTecnicos = db
      .prepare("SELECT id, nombre FROM profiles WHERE rol = 'tecnico' AND activo = 1 ORDER BY nombre ASC")
      .all() as Array<{ id: string; nombre: string }>;

    if (activeTecnicos.length > 0) {
      const validTecIds = new Set(activeTecnicos.map((t) => t.id));
      const allSols = db.prepare('SELECT id, codigo, tecnico_id FROM solicitudes').all() as Array<{
        id: string;
        codigo: string;
        tecnico_id: string;
      }>;
      allSols.forEach((s, idx) => {
        if (!validTecIds.has(s.tecnico_id)) {
          const targetTec = activeTecnicos[idx % activeTecnicos.length];
          db.prepare('UPDATE solicitudes SET tecnico_id = ?, tecnico_nombre = ? WHERE id = ?').run(
            targetTec.id,
            targetTec.nombre,
            s.id
          );
        }
      });

      const allBloqs = db.prepare('SELECT id, tecnico_id, fecha FROM bloqueos').all() as Array<{
        id: string;
        tecnico_id: string;
        fecha: string;
      }>;
      for (const b of allBloqs) {
        if (!validTecIds.has(b.tecnico_id)) {
          const fallbackTec = activeTecnicos[0];
          const conflictBloq = db
            .prepare('SELECT id FROM bloqueos WHERE tecnico_id = ? AND fecha = ?')
            .get(fallbackTec.id, b.fecha);
          if (conflictBloq) {
            db.prepare('DELETE FROM bloqueos WHERE id = ?').run(b.id);
          } else {
            db.prepare('UPDATE bloqueos SET tecnico_id = ?, tecnico_nombre = ? WHERE id = ?').run(
              fallbackTec.id,
              fallbackTec.nombre,
              b.id
            );
          }
        }
      }
    }

    db.prepare('INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)').run(
      'spec_users_version',
      SPEC_VERSION
    );
  });

  tx();
}
