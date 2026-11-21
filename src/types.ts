export type UserRole = 'admin' | 'vendedor' | 'tecnico';

export type SolicitudEstado = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';

export type MotivoVisita =
  | 'Levantamiento técnico'
  | 'Demostración de equipo'
  | 'Mantenimiento / Garantía'
  | 'Capacitación'
  | 'Otro';

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  celular: string;
  especialidad: string;
  activo: boolean;
  cartera_clientes: string[];
  created_at: string;
  updated_at: string;
}

export interface Solicitud {
  id: string;
  codigo: string;
  ejecutivo_email: string;
  ejecutivo_nombre: string;
  cliente: string;
  distrito: string;
  fecha: string; // YYYY-MM-DD
  hora_salida: string; // HH:MM
  hora_retorno: string; // HH:MM
  motivo: string;
  motivo_otro: string;
  tecnico_id: string;
  tecnico_nombre: string;
  contacto_nombre: string;
  contacto_cargo: string;
  contacto_celular: string;
  descripcion: string;
  imagenes: FileRef[];
  estado: SolicitudEstado;
  respondido_por: string | null;
  fecha_respuesta: string | null;
  observacion: string;
  tiene_reporte?: boolean;
  reporte_estado?: 'BORRADOR' | 'ENVIADO' | null;
  created_at: string;
  updated_at: string;
}

export interface FileRef {
  id: string;
  name: string;
  mimeType: string;
  url: string; // HMAC signed temporary URL
}

export interface Reporte {
  id: string;
  solicitud_id: string;
  codigo_visita: string;
  actividades: string[];
  recomendaciones: string;
  pendientes: string;
  imagenes_actividades: FileRef[];
  imagenes_recomendaciones: FileRef[];
  imagenes_pendientes: FileRef[];
  fecha_culminacion: string; // YYYY-MM-DD
  hora_culminacion: string; // HH:MM
  autor_email: string;
  estado_envio: 'BORRADOR' | 'ENVIADO';
  email_enviado: boolean;
  email_detalle: string;
  email_destinatarios: string[];
  pdf_generado_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bloqueo {
  id: string;
  tecnico_id: string;
  tecnico_nombre: string;
  fecha: string; // YYYY-MM-DD
  motivo: string;
  created_by_email: string;
  created_at: string;
}

export interface Configuracion {
  id: number;
  nombre_sistema: string;
  margen_minutos: number;
  permitir_cliente_compartido: boolean;
  updated_at: string;
}

export interface HistorialItem {
  id: string;
  solicitud_id: string | null;
  codigo_visita: string;
  usuario_email: string;
  usuario_nombre: string;
  tipo_accion: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  detalle: string;
  fecha_registro: string;
}

export interface ClienteItem {
  id: string;
  nombre: string;
  ruc: string;
  sector: string;
  activo: boolean;
}

export interface DistritoItem {
  id: string;
  nombre: string;
  provincia: string;
  departamento: string;
  activo: boolean;
}

export interface NotificacionItem {
  id: string;
  destinatario_email: string;
  titulo: string;
  mensaje: string;
  tipo: 'asignacion' | 'respuesta' | 'rechazo_auto' | 'reporte' | 'sistema';
  solicitud_codigo: string | null;
  leida: boolean;
  whatsapp_url: string | null;
  created_at: string;
}

export interface AuthSessionState {
  authenticated: boolean;
  needsInitialAdminSetup: boolean;
  smtpConfigured: boolean;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
  } | null;
  profile: Perfil | null;
  profileStatus: 'ACTIVE' | 'MISSING' | 'DISABLED' | 'UNAUTHENTICATED';
}

export interface BootstrapPayload {
  configuracion: Configuracion;
  clientes: ClienteItem[];
  distritos: DistritoItem[];
  tecnicos: Perfil[];
  ejecutivos: Perfil[];
  solicitudes: Solicitud[];
  bloqueos: Bloqueo[];
  notificaciones: NotificacionItem[];
  serverTime: string;
}
