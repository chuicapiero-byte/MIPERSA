import {
  Bell,
  Calendar,
  ClipboardList,
  Inbox,
  LogOut,
  MessageCircle,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  User,
  Wrench,
} from 'lucide-react';
import React, { useState } from 'react';
import { apiRequest } from '../lib/api.ts';
import { useTheme } from '../lib/theme.tsx';
import type { NotificacionItem, Perfil } from '../types.ts';
import { MipersaWordmark, RolLabel } from './BrandMark.tsx';

interface LayoutShellProps {
  systemName: string;
  currentProfile: Perfil;
  pathname: string;
  notificaciones: NotificacionItem[];
  refreshing: boolean;
  onManualRefresh: () => void;
  onNavigate: (to: string) => void;
  onLogout: () => void;
  onNotificationRead: () => Promise<void>;
  children: React.ReactNode;
}

function getInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'MI';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function LayoutShell({
  systemName,
  currentProfile,
  pathname,
  notificaciones,
  refreshing,
  onManualRefresh,
  onNavigate,
  onLogout,
  onNotificationRead,
  children,
}: LayoutShellProps) {
  const { theme, toggleTheme } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);

  const unreadCount = notificaciones.filter((n) => !n.leida).length;
  const rol = currentProfile.rol;
  const initials = getInitials(currentProfile.nombre);

  const navItems = [
    {
      path: '/panel',
      label: 'Panel',
      icon: Calendar,
      active: pathname === '/' || pathname.startsWith('/panel') || pathname.startsWith('/calendario'),
    },
    {
      path: '/solicitudes',
      label: 'Solicitudes',
      icon: Inbox,
      active: pathname.startsWith('/solicitudes') || pathname === '/nueva-solicitud',
    },
    ...(rol === 'admin' || rol === 'tecnico'
      ? [
          {
            path: '/mi-agenda',
            label: 'Mi agenda',
            icon: Wrench,
            active: pathname.startsWith('/mi-agenda'),
          },
        ]
      : []),
    ...(rol === 'admin'
      ? [
          {
            path: '/auditoria',
            label: 'Auditoría',
            icon: ClipboardList,
            active: pathname.startsWith('/auditoria'),
          },
          {
            path: '/configuracion',
            label: 'Configuración',
            icon: Settings,
            active: pathname.startsWith('/configuracion') || pathname.startsWith('/admin'),
          },
        ]
      : []),
  ];

  const handleOpenNotifItem = async (n: NotificacionItem) => {
    if (!n.leida) {
      await apiRequest(`/api/notificaciones/${n.id}/leer`, { method: 'POST' });
      await onNotificationRead();
    }
    setNotifOpen(false);
    if (n.solicitud_codigo) {
      onNavigate(`/solicitudes/${encodeURIComponent(n.solicitud_codigo)}`);
    }
  };

  const mobileGridClass =
    navItems.length === 5
      ? 'grid-cols-5'
      : navItems.length === 3
        ? 'grid-cols-3'
        : 'grid-cols-2';

  return (
    <div className="min-h-dvh bg-[#F4F6FA] dark:bg-[#0B0F17] flex">
      {/* Desktop Corporate Navy Sidebar (matches MIPERSA mockup) */}
      <aside
        aria-label={systemName}
        className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#061A3E] text-white border-r border-[#0E295B] sticky top-0 h-dvh"
      >
        <div className="px-5 pt-5 pb-4">
          <MipersaWordmark boxed />
          <div className="flex items-center gap-2 mt-4 px-1">
            <span className="w-3.5 h-0.5 bg-[#E10600] shrink-0" aria-hidden="true" />
            <span className="text-[11px] font-semibold tracking-[0.14em] text-slate-300 uppercase">
              VISITAS TÉCNICAS
            </span>
          </div>
        </div>

        <nav aria-label="Navegación principal" className="flex-1 px-3 py-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => onNavigate(item.path)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap ${
                  item.active
                    ? 'bg-[#122D5E] text-white border border-white/10 shadow-xs'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0 opacity-90" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5">
          <div className="rounded-2xl border border-white/10 bg-[#041432]/75 p-3.5 space-y-3">
            <button
              type="button"
              onClick={() => onNavigate('/perfil')}
              className="w-full text-left group"
              title="Ver Mi Perfil y seguridad MFA"
            >
              <p className="text-sm font-semibold text-white truncate group-hover:underline">
                {currentProfile.nombre}
              </p>
              <p className="text-xs text-slate-300 mt-0.5">
                <RolLabel rol={currentProfile.rol} />
              </p>
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-medium text-white flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 safe-top">
          <div className="h-16 px-5 sm:px-6 lg:px-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="lg:hidden">
                <MipersaWordmark compact />
              </div>

              {/* User Avatar + Name & Role (Desktop & Tablet) */}
              <button
                type="button"
                onClick={() => onNavigate('/perfil')}
                className="flex items-center gap-3 min-w-0 text-left rounded-xl py-1 pr-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                title={`${systemName} — Mi Perfil`}
              >
                <span className="hidden sm:flex w-9 h-9 rounded-full bg-red-50 dark:bg-red-950/60 border border-red-100 dark:border-red-900/50 text-[#C8102E] dark:text-red-400 font-heading font-bold text-xs items-center justify-center shrink-0">
                  {initials}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#061A3E] dark:text-white truncate">
                    {currentProfile.nombre}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    <RolLabel rol={currentProfile.rol} />
                  </p>
                </div>
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Light / Dark Mode Switch */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {/* Notifications */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  aria-label="Notificaciones"
                  className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 relative"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E10600] text-white font-mono text-[10px] font-bold flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setNotifOpen(false)}
                      aria-hidden="true"
                    />
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70dvh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 divide-y divide-slate-100 dark:divide-slate-800">
                      <div className="px-4 py-3 flex items-center justify-between">
                        <span className="font-heading text-sm font-bold text-slate-900 dark:text-white">
                          Notificaciones
                        </span>
                        <span className="text-xs font-mono text-slate-500">
                          {unreadCount} sin leer
                        </span>
                      </div>

                      {notificaciones.length === 0 ? (
                        <div className="p-5 text-center text-xs text-slate-500 dark:text-slate-400">
                          No tienes notificaciones recientes.
                        </div>
                      ) : (
                        notificaciones.map((n) => (
                          <div
                            key={n.id}
                            className={`p-3.5 space-y-1.5 ${
                              n.leida ? 'opacity-70' : 'bg-red-50/40 dark:bg-red-950/10'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleOpenNotifItem(n)}
                              className="w-full text-left"
                            >
                              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                {n.titulo}
                              </p>
                              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                                {n.mensaje}
                              </p>
                            </button>
                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                              <span className="font-mono">
                                {new Date(n.created_at).toLocaleString('es-PE')}
                              </span>
                              {n.whatsapp_url && (
                                <a
                                  href={n.whatsapp_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline"
                                >
                                  <MessageCircle className="w-3 h-3" />
                                  WhatsApp
                                </a>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Manual Global Refresh */}
              <button
                type="button"
                onClick={onManualRefresh}
                disabled={refreshing}
                aria-label="Actualizar información del servidor"
                title="Actualizar información"
                className="min-h-[40px] min-w-[40px] sm:px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#061A3E] dark:text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Actualizar</span>
              </button>

              {/* Mobile Profile Button */}
              <button
                type="button"
                onClick={() => onNavigate('/perfil')}
                aria-label="Mi Perfil"
                title="Mi Perfil"
                className={`lg:hidden min-h-[40px] min-w-[40px] rounded-xl border flex items-center justify-center ${
                  pathname.startsWith('/perfil')
                    ? 'border-[#C8102E] text-[#C8102E] dark:text-red-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                <User className="w-4 h-4" />
              </button>

              {/* Mobile Sign Out */}
              <button
                type="button"
                onClick={onLogout}
                aria-label="Cerrar sesión"
                className="lg:hidden min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 w-full max-w-7xl min-w-0 mx-auto px-5 sm:px-6 lg:px-10 py-6 lg:py-8 pb-24 lg:pb-12">
          <div className="safe-x min-w-0">{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Navegación principal móvil"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 safe-bottom-nav"
      >
        <div className={`grid ${mobileGridClass} h-14 items-center`}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => onNavigate(item.path)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  item.active
                    ? 'text-[#E10600] dark:text-red-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="truncate max-w-[72px]">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
