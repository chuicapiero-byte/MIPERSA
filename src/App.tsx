/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminView } from './components/AdminView.tsx';
import { AuditoriaView } from './components/AuditoriaView.tsx';
import { AuthViews } from './components/AuthViews.tsx';
import { CalendarioView } from './components/CalendarioView.tsx';
import { LayoutShell } from './components/LayoutShell.tsx';
import { NuevaSolicitudModal } from './components/NuevaSolicitudModal.tsx';
import { PerfilSeguridadView } from './components/PerfilSeguridadView.tsx';
import { QuickActionView } from './components/QuickActionView.tsx';
import { SolicitudDetailView } from './components/SolicitudDetailView.tsx';
import { SolicitudesView } from './components/SolicitudesView.tsx';
import { apiRequest } from './lib/api.ts';
import { getQueryParams, sanitizeReturnTo, useSpaRouter } from './lib/router.tsx';
import { ThemeProvider } from './lib/theme.tsx';
import type { AuthSessionState, BootstrapPayload, Solicitud } from './types.ts';

const AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/mfa',
]);

function AccesoDenegadoView({ onBack }: { onBack: () => void }) {
  return (
    <div className="max-w-lg mx-auto my-8 rounded-2xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 p-6 sm:p-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/50 text-[#C8102E] dark:text-red-400 flex items-center justify-center mx-auto">
        <ShieldAlert className="w-6 h-6" />
      </div>
      <h1 className="font-heading text-xl font-bold text-slate-900 dark:text-white">
        Acceso restringido
      </h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Tu perfil funcional no tiene permisos autorizados para acceder a esta sección del sistema.
      </p>
      <div className="pt-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-5 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium transition-colors"
        >
          Volver al Panel principal
        </button>
      </div>
    </div>
  );
}

function MipersaApp() {
  const { pathname, search, fullPath, navigate } = useSpaRouter();
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [nuevaPrefill, setNuevaPrefill] = useState<{
    fecha?: string;
    tecnicoId?: string;
  } | null>(null);
  const [createdBanner, setCreatedBanner] = useState<{
    codigo: string;
    tecnicoNombre: string;
    whatsappUrl: string | null;
  } | null>(null);

  const openNuevaModal = useCallback((prefill?: { fecha?: string; tecnicoId?: string }) => {
    setNuevaPrefill(prefill || null);
    setNuevaOpen(true);
  }, []);

  const pollTimerRef = useRef<number | null>(null);
  const hasLoadedBootstrapRef = useRef(false);

  const fetchSession = useCallback(async () => {
    const s = await apiRequest<AuthSessionState>('/api/auth/session');
    setSession(s);
    return s;
  }, []);

  const fetchBootstrap = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      else if (!hasLoadedBootstrapRef.current) setLoadingBootstrap(true);
      try {
        const data = await apiRequest<BootstrapPayload>('/api/bootstrap');
        hasLoadedBootstrapRef.current = true;
        setBootstrap(data);
      } catch {
        await fetchSession().catch(() => {});
      } finally {
        setLoadingBootstrap(false);
        setRefreshing(false);
      }
    },
    [fetchSession]
  );

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Redirect to login preserving returnTo if unauthenticated on protected route
  useEffect(() => {
    if (!session) return;
    if (pathname === '/respuesta-rapida') return;
    const isAuthRoute = AUTH_PATHS.has(pathname);

    if (!session.authenticated) {
      if (!isAuthRoute) {
        const targetReturn = sanitizeReturnTo(fullPath === '/' ? '/panel' : fullPath);
        navigate(`/login?returnTo=${encodeURIComponent(targetReturn)}`, true);
      }
      return;
    }

    if (session.profileStatus === 'ACTIVE' && (isAuthRoute || pathname === '/')) {
      const target = sanitizeReturnTo(getQueryParams(search).get('returnTo'));
      navigate(target, true);
    }
  }, [session, pathname, search, fullPath, navigate]);

  // Initial load & Smart Visibility-Aware Polling (pauses when tab or WebView is hidden)
  useEffect(() => {
    if (!session?.authenticated || session.profileStatus !== 'ACTIVE') {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    fetchBootstrap();

    const startPolling = () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (document.visibilityState === 'visible') {
        pollTimerRef.current = window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            fetchBootstrap();
          }
        }, 20000);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchBootstrap();
        startPolling();
      } else if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [session?.authenticated, session?.profileStatus, fetchBootstrap]);

  // Handle /nueva-solicitud direct deep link ONLY if role permits creating requests
  useEffect(() => {
    if (
      pathname === '/nueva-solicitud' &&
      session?.profileStatus === 'ACTIVE' &&
      (session.profile?.rol === 'vendedor' || session.profile?.rol === 'admin')
    ) {
      setNuevaOpen(true);
    }
  }, [pathname, session?.profileStatus, session?.profile?.rol]);

  const handleLogout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    hasLoadedBootstrapRef.current = false;
    setBootstrap(null);
    await fetchSession();
    navigate('/login', true);
  };

  if (pathname === '/respuesta-rapida') {
    return (
      <QuickActionView
        search={search}
        authenticated={Boolean(session?.authenticated && session.profileStatus === 'ACTIVE')}
        onNavigate={(to) => navigate(to, true)}
        onActionCompleted={
          session?.authenticated && session.profileStatus === 'ACTIVE'
            ? () => fetchBootstrap()
            : undefined
        }
      />
    );
  }

  if (!session) {
    return (
      <div className="min-h-dvh bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-center p-6">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Cargando Gestor de Visitas MIPERSA...
        </div>
      </div>
    );
  }

  if (!session.authenticated || session.profileStatus !== 'ACTIVE' || !session.profile) {
    return (
      <AuthViews
        pathname={pathname}
        search={search}
        session={session}
        navigate={navigate}
        onSessionRefresh={async () => {
          await fetchSession();
        }}
      />
    );
  }

  const profile = session.profile;
  const systemName = bootstrap?.configuracion.nombre_sistema || 'Gestor de Visitas MIPERSA';
  const margenMinutos = bootstrap?.configuracion.margen_minutos ?? 60;

  // Match /solicitudes/:codigo
  const detailMatch = /^\/solicitudes\/([^/]+)$/.exec(pathname);
  const detailCodigo = detailMatch ? decodeURIComponent(detailMatch[1]) : null;

  const isNuevaForbidden = pathname === '/nueva-solicitud' && profile.rol === 'tecnico';
  const isMiAgendaRoute = pathname.startsWith('/mi-agenda');
  const isAuditoriaRoute = pathname.startsWith('/auditoria');
  const isConfigRoute = pathname.startsWith('/configuracion') || pathname.startsWith('/admin');
  const isPanelRoute = pathname === '/' || pathname.startsWith('/panel') || pathname.startsWith('/calendario');

  let mainContent: React.ReactNode;

  if (detailCodigo) {
    mainContent = (
      <SolicitudDetailView
        codigo={detailCodigo}
        currentProfile={profile}
        margenMinutos={margenMinutos}
        onBack={() => navigate('/solicitudes')}
        onGlobalRefresh={() => fetchBootstrap()}
      />
    );
  } else if (isNuevaForbidden) {
    mainContent = <AccesoDenegadoView onBack={() => navigate('/panel')} />;
  } else if (isMiAgendaRoute) {
    if (profile.rol === 'admin' || profile.rol === 'tecnico') {
      mainContent = (
        <CalendarioView
          mode="mi-agenda"
          solicitudes={bootstrap?.solicitudes || []}
          bloqueos={bootstrap?.bloqueos || []}
          tecnicos={bootstrap?.tecnicos || []}
          currentProfile={profile}
          margenMinutos={margenMinutos}
          onNavigateSolicitud={(codigo) => navigate(`/solicitudes/${encodeURIComponent(codigo)}`)}
          onRefresh={() => fetchBootstrap()}
        />
      );
    } else {
      mainContent = <AccesoDenegadoView onBack={() => navigate('/panel')} />;
    }
  } else if (isAuditoriaRoute) {
    if (profile.rol === 'admin') {
      mainContent = <AuditoriaView />;
    } else {
      mainContent = <AccesoDenegadoView onBack={() => navigate('/panel')} />;
    }
  } else if (isConfigRoute) {
    if (profile.rol === 'admin') {
      mainContent = (
        <AdminView
          currentProfile={profile}
          configuracion={
            bootstrap?.configuracion || {
              id: 1,
              nombre_sistema: systemName,
              margen_minutos: margenMinutos,
              permitir_cliente_compartido: true,
              updated_at: '',
            }
          }
          onRefresh={() => fetchBootstrap()}
        />
      );
    } else {
      mainContent = <AccesoDenegadoView onBack={() => navigate('/panel')} />;
    }
  } else if (pathname.startsWith('/perfil')) {
    mainContent = (
      <PerfilSeguridadView
        session={session}
        onSessionRefresh={async () => {
          await fetchSession();
        }}
      />
    );
  } else if (isPanelRoute) {
    mainContent = (
      <CalendarioView
        mode="panel"
        solicitudes={bootstrap?.solicitudes || []}
        bloqueos={bootstrap?.bloqueos || []}
        tecnicos={bootstrap?.tecnicos || []}
        currentProfile={profile}
        margenMinutos={margenMinutos}
        onNavigateSolicitud={(codigo) => navigate(`/solicitudes/${encodeURIComponent(codigo)}`)}
        onOpenNueva={
          profile.rol === 'vendedor' || profile.rol === 'admin'
            ? openNuevaModal
            : undefined
        }
        onRefresh={() => fetchBootstrap()}
      />
    );
  } else {
    mainContent = (
      <SolicitudesView
        solicitudes={bootstrap?.solicitudes || []}
        currentProfile={profile}
        tecnicos={bootstrap?.tecnicos || []}
        ejecutivos={bootstrap?.ejecutivos || []}
        loading={loadingBootstrap}
        onSelectSolicitud={(codigo) => navigate(`/solicitudes/${encodeURIComponent(codigo)}`)}
        onOpenNueva={() => openNuevaModal()}
        onRefresh={() => fetchBootstrap()}
      />
    );
  }

  return (
    <LayoutShell
      systemName={systemName}
      currentProfile={profile}
      pathname={pathname}
      notificaciones={bootstrap?.notificaciones || []}
      refreshing={refreshing}
      onManualRefresh={() => fetchBootstrap(true)}
      onNavigate={(to) => navigate(to)}
      onLogout={handleLogout}
      onNotificationRead={() => fetchBootstrap()}
    >
      {createdBanner && (
        <div
          role="status"
          className="mb-4 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 text-sm flex flex-wrap items-center justify-between gap-2.5"
        >
          <span>
            Solicitud <strong>{createdBanner.codigo}</strong> creada y asignada a{' '}
            <strong>{createdBanner.tecnicoNombre}</strong>.
          </span>
          <div className="flex items-center gap-2">
            {createdBanner.whatsappUrl && (
              <a
                href={createdBanner.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                Enviar por WhatsApp al asesor
              </a>
            )}
            <button
              type="button"
              onClick={() => setCreatedBanner(null)}
              className="min-h-[36px] px-2.5 rounded-lg border border-emerald-300 dark:border-emerald-800 text-xs font-medium"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {mainContent}

      {(profile.rol === 'vendedor' || profile.rol === 'admin') && bootstrap && (
        <NuevaSolicitudModal
          open={nuevaOpen}
          onClose={() => {
            setNuevaOpen(false);
            setNuevaPrefill(null);
            if (pathname === '/nueva-solicitud') {
              navigate('/solicitudes', true);
            }
          }}
          onCreated={async (sol: Solicitud, whatsappTecnicoUrl?: string | null) => {
            setCreatedBanner({
              codigo: sol.codigo,
              tecnicoNombre: sol.tecnico_nombre,
              whatsappUrl: whatsappTecnicoUrl || null,
            });
            await fetchBootstrap();
          }}
          currentProfile={profile}
          clientes={bootstrap.clientes}
          distritos={bootstrap.distritos}
          tecnicos={bootstrap.tecnicos}
          ejecutivos={bootstrap.ejecutivos}
          margenMinutos={margenMinutos}
          initialFecha={nuevaPrefill?.fecha || null}
          initialTecnicoId={nuevaPrefill?.tecnicoId || null}
        />
      )}
    </LayoutShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MipersaApp />
    </ThemeProvider>
  );
}
