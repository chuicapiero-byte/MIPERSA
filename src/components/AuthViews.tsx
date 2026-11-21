import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  LogOut,
  MailCheck,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import { getQueryParams, sanitizeReturnTo } from '../lib/router.tsx';
import { useTheme } from '../lib/theme.tsx';
import type { AuthSessionState } from '../types.ts';
import { MipersaWordmark } from './BrandMark.tsx';

interface AuthViewsProps {
  pathname: string;
  search: string;
  session: AuthSessionState;
  navigate: (to: string, replace?: boolean) => void;
  onSessionRefresh: () => Promise<void>;
}

const HERO_IMG_URL = '/src/assets/images/mipersa_industrial_hero_1795271061254.jpg';

export function AuthViews({
  pathname,
  search,
  session,
  navigate,
  onSessionRefresh,
}: AuthViewsProps) {
  const { theme, toggleTheme } = useTheme();
  const params = getQueryParams(search);
  const returnTo = sanitizeReturnTo(params.get('returnTo'));

  const [imgError, setImgError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  // Form states
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('Carlos Mendoza Quispe');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');

  // Auto-verify email if landing on /verify-email?token=...
  const urlToken = params.get('token') || '';
  const [verifyDone, setVerifyDone] = useState(false);

  useEffect(() => {
    setErrorMsg('');
    setInfoMsg('');
  }, [pathname]);

  useEffect(() => {
    if (pathname === '/verify-email' && urlToken && !verifyDone) {
      setLoading(true);
      apiRequest<{ ok: boolean; email: string; returnTo: string }>('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: urlToken, returnTo }),
      })
        .then(async (res) => {
          setVerifyDone(true);
          setInfoMsg(`Correo ${res.email} verificado correctamente.`);
          await onSessionRefresh();
          navigate(sanitizeReturnTo(res.returnTo), true);
        })
        .catch((err: unknown) => {
          setErrorMsg(err instanceof Error ? err.message : 'No se pudo verificar el enlace.');
        })
        .finally(() => setLoading(false));
    }
  }, [pathname, urlToken, verifyDone, returnTo, onSessionRefresh, navigate]);

  const handleSetupAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (password.length < 8) {
      setErrorMsg('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; returnTo: string }>('/api/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify({
          email: email || 'admin@mipersa.pe',
          nombre,
          password,
          returnTo,
        }),
      });
      await onSessionRefresh();
      navigate(sanitizeReturnTo(res.returnTo), true);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo activar la cuenta.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{
        ok?: boolean;
        mfaRequired?: boolean;
        mfaToken?: string;
        returnTo?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, returnTo }),
      });

      if (res.mfaRequired && res.mfaToken) {
        setMfaChallengeToken(res.mfaToken);
        navigate(`/mfa?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }

      await onSessionRefresh();
      navigate(sanitizeReturnTo(res.returnTo || returnTo), true);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; returnTo: string }>('/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({
          mfaToken: mfaChallengeToken,
          code: mfaCode,
          returnTo,
        }),
      });
      await onSessionRefresh();
      navigate(sanitizeReturnTo(res.returnTo), true);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Código MFA inválido.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (password.length < 8) {
      setErrorMsg('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        emailVerificationRequired: boolean;
        emailSent: boolean;
        emailDetail: string;
        profileEnabled: boolean;
        returnTo: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, returnTo }),
      });

      if (res.emailVerificationRequired) {
        setInfoMsg(
          res.emailSent
            ? 'Cuenta creada. Revisa tu correo electrónico para verificar tu cuenta.'
            : `Cuenta creada, pero no se pudo enviar el correo de verificación: ${res.emailDetail}`
        );
        return;
      }

      await onSessionRefresh();
      if (res.profileEnabled) {
        navigate(sanitizeReturnTo(res.returnTo), true);
      }
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo registrar la cuenta.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{ sent: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email, returnTo }),
      });
      if (res.sent) {
        setInfoMsg(res.message);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo procesar la solicitud.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (password.length < 8) {
      setErrorMsg('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      await apiRequest<{ ok: boolean; returnTo: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: urlToken, password, returnTo }),
      });
      setInfoMsg('Contraseña actualizada correctamente. Ya puedes iniciar sesión.');
      setTimeout(() => {
        navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      }, 1200);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo restablecer la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    await onSessionRefresh();
    navigate('/login', true);
  };

  // Authenticated but account not yet enabled in MIPERSA profiles
  if (session.authenticated && session.profileStatus !== 'ACTIVE') {
    return (
      <div className="min-h-dvh bg-slate-50 dark:bg-[#0B0F17] safe-top safe-bottom flex flex-col">
        <div className="flex-1 flex flex-col justify-center items-center px-5 py-8">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <MipersaWordmark />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Alternar tema"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="font-heading text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Cuenta aún no habilitada
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            Has iniciado sesión con <strong className="text-slate-900 dark:text-white">{session.user?.email}</strong>,
            {session.profileStatus === 'DISABLED'
              ? ' pero tu perfil corporativo en MIPERSA se encuentra temporalmente desactivado.'
              : ' pero tu cuenta todavía no cuenta con un perfil habilitado en el Gestor de Visitas MIPERSA.'}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
            Solicita al Administrador de Operaciones que registre o active tu correo corporativo y te asigne un rol funcional (Administrador, Ejecutivo Comercial o Asesor Técnico).
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
          </div>
        </div>
      </div>
    );
  }

  const isSetupView = session.needsInitialAdminSetup && pathname === '/login';

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-[#0B0F17] grid grid-cols-1 lg:grid-cols-12">
      {/* Left Brand Showcase on Desktop */}
      <div className="hidden lg:flex lg:col-span-5 relative overflow-hidden bg-[#061A3E]">
        {!imgError ? (
          <img
            src={HERO_IMG_URL}
            alt="Centro de ingeniería y servicio técnico MIPERSA"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover opacity-55"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#061A3E] via-[#0B2554] to-[#041432]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#041432]/95 via-[#061A3E]/65 to-[#061A3E]/45 flex flex-col justify-between p-10">
          <div className="w-56">
            <MipersaWordmark boxed />
          </div>

          <div className="max-w-md">
            <p className="text-xs font-mono tracking-wider text-red-400 mb-2">
              COORDINACIÓN COMERCIAL Y TÉCNICA
            </p>
            <h2 className="font-heading text-3xl font-bold text-white leading-tight mb-4">
              Control centralizado de visitas técnicas en campo
            </h2>
            <p className="text-sm text-slate-200 leading-relaxed">
              Programa acompañamientos técnicos, evita cruces de agenda considerando tiempos de traslado y emite informes técnicos en PDF directamente desde la plataforma.
            </p>
          </div>
        </div>
      </div>

      {/* Right Auth Form Column */}
      <div className="lg:col-span-7 flex flex-col safe-top safe-bottom">
        <div className="flex-1 flex flex-col justify-between px-5 py-6 sm:px-10 sm:py-10">
        <div className="flex items-center justify-between max-w-md w-full mx-auto">
          <MipersaWordmark />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Cambiar entre modo claro y oscuro"
            className="min-h-[44px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
          </button>
        </div>

        <div className="w-full max-w-md mx-auto my-8">
          {errorMsg && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoMsg && (
            <div
              role="status"
              className="mb-5 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-sm flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{infoMsg}</span>
            </div>
          )}

          {isSetupView ? (
            <form onSubmit={handleSetupAdmin} className="space-y-4">
              <div>
                <p className="text-xs font-medium text-[#C8102E] dark:text-red-400 mb-1">
                  Configuración inicial única
                </p>
                <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
                  Activar Administrador Inicial
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5">
                  Define la contraseña del administrador corporativo para habilitar el sistema y gestionar los perfiles de MIPERSA.
                </p>
              </div>

              <div>
                <label htmlFor="setup-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Correo corporativo (@mipersa.pe)
                </label>
                <input
                  id="setup-email"
                  type="email"
                  required
                  value={email || 'admin@mipersa.pe'}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@mipersa.pe"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>

              <div>
                <label htmlFor="setup-nombre" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Nombre completo
                </label>
                <input
                  id="setup-nombre"
                  type="text"
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>

              <div>
                <label htmlFor="setup-pass" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Contraseña (mínimo 8 caracteres)
                </label>
                <input
                  id="setup-pass"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>

              <div>
                <label htmlFor="setup-pass2" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirmar contraseña
                </label>
                <input
                  id="setup-pass2"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm transition-colors disabled:opacity-60"
              >
                {loading ? 'Activando cuenta...' : 'Activar Administrador e Ingresar'}
              </button>
            </form>
          ) : pathname === '/mfa' ? (
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-red-950/50 text-[#C8102E] dark:text-red-400 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
                Verificación en dos pasos
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ingresa el código de 6 dígitos generado por tu aplicación autenticadora para continuar.
              </p>
              <div>
                <label htmlFor="mfa-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Código MFA
                </label>
                <input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full min-h-[44px] px-4 py-2.5 font-mono text-lg tracking-widest text-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !mfaChallengeToken}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm transition-colors disabled:opacity-60"
              >
                {loading ? 'Verificando...' : 'Verificar e Ingresar'}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`)}
                className="w-full min-h-[44px] text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                Volver al inicio de sesión
              </button>
            </form>
          ) : pathname === '/register' ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
                  Registro de cuenta
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Crea tu acceso con tu correo <span className="font-mono">@mipersa.pe</span> o un correo autorizado por un Administrador.
                </p>
              </div>
              <div>
                <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Correo electrónico
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre.apellido@mipersa.pe o correo autorizado"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <div>
                <label htmlFor="reg-pass" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Contraseña (mínimo 8 caracteres)
                </label>
                <input
                  id="reg-pass"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <div>
                <label htmlFor="reg-pass2" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirmar contraseña
                </label>
                <input
                  id="reg-pass2"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm transition-colors disabled:opacity-60"
              >
                {loading ? 'Registrando...' : 'Crear cuenta corporativa'}
              </button>
              <div className="pt-2 text-center text-sm text-slate-600 dark:text-slate-400">
                ¿Ya tienes cuenta?{' '}
                <button
                  type="button"
                  onClick={() => navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`)}
                  className="text-[#C8102E] dark:text-red-400 font-medium hover:underline"
                >
                  Iniciar sesión
                </button>
              </div>
            </form>
          ) : pathname === '/forgot-password' ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center">
                <KeyRound className="w-5 h-5" />
              </div>
              <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
                Recuperar contraseña
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ingresa tu correo <span className="font-mono">@mipersa.pe</span> o correo autorizado para recibir un enlace de restablecimiento.
              </p>
              <div>
                <label htmlFor="forgot-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Correo electrónico
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@mipersa.pe o correo autorizado"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm transition-colors disabled:opacity-60"
              >
                {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`)}
                className="w-full min-h-[44px] text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                Volver a iniciar sesión
              </button>
            </form>
          ) : pathname === '/reset-password' ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
                Restablecer contraseña
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ingresa una nueva contraseña segura para tu cuenta corporativa.
              </p>
              <div>
                <label htmlFor="reset-pass" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Nueva contraseña
                </label>
                <input
                  id="reset-pass"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <div>
                <label htmlFor="reset-pass2" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirmar contraseña
                </label>
                <input
                  id="reset-pass2"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !urlToken}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm transition-colors disabled:opacity-60"
              >
                {loading ? 'Guardando...' : 'Actualizar contraseña'}
              </button>
            </form>
          ) : pathname === '/verify-email' ? (
            <div className="space-y-4">
              <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center">
                <MailCheck className="w-5 h-5" />
              </div>
              <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
                Verificación de correo
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {loading
                  ? 'Validando tu enlace de verificación corporativa...'
                  : 'Si el enlace expiró, solicita uno nuevo al Administrador o vuelve al inicio de sesión.'}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`)}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm"
              >
                Ir a iniciar sesión
              </button>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
                  Iniciar sesión
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Accede con tu correo <span className="font-mono">@mipersa.pe</span> o correo autorizado.
                </p>
              </div>
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Correo electrónico
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre.apellido@mipersa.pe o correo autorizado"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-pass" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Contraseña
                  </label>
                  <button
                    type="button"
                    onClick={() => navigate(`/forgot-password?returnTo=${encodeURIComponent(returnTo)}`)}
                    className="text-xs text-[#C8102E] dark:text-red-400 hover:underline min-h-[32px] flex items-center"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <input
                  id="login-pass"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#C8102E]/30 focus:border-[#C8102E]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white font-medium text-sm transition-colors disabled:opacity-60"
              >
                {loading ? 'Ingresando...' : 'Ingresar a MIPERSA'}
              </button>
              <div className="pt-2 text-center text-sm text-slate-600 dark:text-slate-400">
                ¿Primera vez en el sistema?{' '}
                <button
                  type="button"
                  onClick={() => navigate(`/register?returnTo=${encodeURIComponent(returnTo)}`)}
                  className="text-[#C8102E] dark:text-red-400 font-medium hover:underline"
                >
                  Registrarse
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 max-w-md w-full mx-auto">
          Gestor de Visitas MIPERSA · Uso exclusivo para personal autorizado.
        </p>
        </div>
      </div>
    </div>
  );
}
