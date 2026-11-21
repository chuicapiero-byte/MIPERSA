import { AlertCircle, CheckCircle2, ShieldCheck, ShieldOff } from 'lucide-react';
import React, { useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import type { AuthSessionState } from '../types.ts';
import { RolLabel } from './BrandMark.tsx';

interface PerfilSeguridadViewProps {
  session: AuthSessionState;
  onSessionRefresh: () => Promise<void>;
}

export function PerfilSeguridadView({
  session,
  onSessionRefresh,
}: PerfilSeguridadViewProps) {
  const profile = session.profile!;
  const mfaEnabled = Boolean(session.user?.mfaEnabled);

  const [setupData, setSetupData] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const handleStartMfaSetup = async () => {
    setErrorMsg('');
    setOkMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{ secret: string; otpauthUri: string }>('/api/auth/mfa/setup', {
        method: 'POST',
      });
      setSetupData(res);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo iniciar la configuración MFA.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setOkMsg('');
    setLoading(true);
    try {
      await apiRequest('/api/auth/mfa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: totpCode }),
      });
      setSetupData(null);
      setTotpCode('');
      setOkMsg('Autenticación en dos pasos (MFA) activada correctamente.');
      await onSessionRefresh();
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Código MFA inválido.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setOkMsg('');
    setLoading(true);
    try {
      await apiRequest('/api/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePassword }),
      });
      setDisablePassword('');
      setOkMsg('Autenticación en dos pasos desactivada.');
      await onSessionRefresh();
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo desactivar MFA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
          Mi Perfil y Seguridad
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Información de tu cuenta corporativa y protección de acceso con MFA.
        </p>
      </div>

      {/* Datos del perfil */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
        <h2 className="font-heading text-base font-bold text-slate-900 dark:text-white">
          Ficha corporativa
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Nombre completo</p>
            <p className="font-medium text-slate-900 dark:text-white mt-0.5">{profile.nombre}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Correo corporativo</p>
            <p className="font-mono text-slate-900 dark:text-white mt-0.5">{profile.email}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Rol funcional</p>
            <p className="font-medium text-[#C8102E] dark:text-red-400 mt-0.5">
              <RolLabel rol={profile.rol} />
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Celular y especialidad</p>
            <p className="text-slate-900 dark:text-white mt-0.5">
              {profile.celular || '—'} · {profile.especialidad || 'General'}
            </p>
          </div>
        </div>

        {profile.rol === 'vendedor' && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
              Cartera de clientes asignada ({profile.cartera_clientes.length || 'Acceso general'})
            </p>
            {profile.cartera_clientes.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Tienes acceso habilitado a toda la cartera activa de MIPERSA.
              </p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                {profile.cartera_clientes.map((c) => (
                  <li key={c}>· {c}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Seguridad MFA */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {mfaEnabled ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              ) : (
                <ShieldOff className="w-5 h-5 text-slate-400" />
              )}
              <span>Autenticación en dos pasos (MFA TOTP)</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
              {mfaEnabled
                ? 'Tu cuenta está protegida con códigos TOTP de 6 dígitos al iniciar sesión.'
                : 'Añade una capa adicional de seguridad usando Google Authenticator, Microsoft Authenticator o Apple Contraseñas.'}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {okMsg && (
          <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-sm flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{okMsg}</span>
          </div>
        )}

        {!mfaEnabled && !setupData && (
          <button
            type="button"
            disabled={loading}
            onClick={handleStartMfaSetup}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium"
          >
            Configurar verificación en dos pasos
          </button>
        )}

        {!mfaEnabled && setupData && (
          <form onSubmit={handleEnableMfa} className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 text-xs sm:text-sm">
              <p className="font-medium text-slate-900 dark:text-white">
                1. Agrega esta clave secreta manualmente en tu app autenticadora:
              </p>
              <p className="font-mono text-sm font-bold text-[#C8102E] dark:text-red-400 break-all selectable-text">
                {setupData.secret}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 break-all selectable-text">
                URI TOTP: {setupData.otpauthUri}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                2. Ingresa el código de 6 dígitos generado para confirmar
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full max-w-xs min-h-[44px] px-3.5 py-2 font-mono text-center tracking-widest rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex gap-2.5">
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium"
              >
                Activar MFA
              </button>
              <button
                type="button"
                onClick={() => setSetupData(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {mfaEnabled && (
          <form onSubmit={handleDisableMfa} className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Para desactivar MFA, confirma tu contraseña actual:
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="password"
                required
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Contraseña actual"
                className="flex-1 max-w-xs min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                Desactivar MFA
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
