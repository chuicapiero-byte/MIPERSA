import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  KeyRound,
  MapPin,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api.ts';
import type {
  ClienteItem,
  Configuracion,
  DistritoItem,
  Perfil,
  UserRole,
} from '../types.ts';
import { RolLabel } from './BrandMark.tsx';

interface ConfiguracionViewProps {
  currentProfile: Perfil;
  configuracion: Configuracion;
  onRefresh: () => Promise<void>;
}

function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function AdminView({
  currentProfile,
  configuracion,
  onRefresh,
}: ConfiguracionViewProps) {
  const [section, setSection] = useState<'parametros' | 'equipo' | 'carteras' | 'distritos'>(
    'parametros'
  );
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [distritos, setDistritos] = useState<DistritoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');

  // 1. Parámetros del sistema
  const [nombreSistema, setNombreSistema] = useState(configuracion.nombre_sistema);
  const [margenMinutos, setMargenMinutos] = useState(String(configuracion.margen_minutos));
  const [permitirCompartido, setPermitirCompartido] = useState(
    configuracion.permitir_cliente_compartido ?? true
  );
  const [savingCfg, setSavingCfg] = useState(false);

  // 2. Equipo autorizado (modal + búsqueda)
  const [equipoSearch, setEquipoSearch] = useState('');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingPerfil, setEditingPerfil] = useState<Perfil | null>(null);
  const [pEmail, setPEmail] = useState('');
  const [pNombre, setPNombre] = useState('');
  const [pRol, setPRol] = useState<UserRole>('vendedor');
  const [pCelular, setPCelular] = useState('');
  const [pEspecialidad, setPEspecialidad] = useState('');
  const [pActivo, setPActivo] = useState(true);
  const [savingPerfil, setSavingPerfil] = useState(false);
  const [resetLinkModal, setResetLinkModal] = useState<{ email: string; url: string } | null>(null);

  // 3. Carteras de ejecutivos
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedVendorClientes, setSelectedVendorClientes] = useState<string[]>([]);
  const [carteraSearch, setCarteraSearch] = useState('');
  const [savingCartera, setSavingCartera] = useState(false);
  const [newCliNombre, setNewCliNombre] = useState('');
  const [newCliRuc, setNewCliRuc] = useState('');
  const [addingCliente, setAddingCliente] = useState(false);

  // 4. Catálogo de distritos
  const [distritoSearch, setDistritoSearch] = useState('');
  const [newDistNombre, setNewDistNombre] = useState('');
  const [newDistProvincia, setNewDistProvincia] = useState('Lima');
  const [newDistDepartamento, setNewDistDepartamento] = useState('Lima');
  const [addingDistrito, setAddingDistrito] = useState(false);
  const [editingDistrito, setEditingDistrito] = useState<DistritoItem | null>(null);
  const [editDistNombre, setEditDistNombre] = useState('');
  const [editDistProvincia, setEditDistProvincia] = useState('');
  const [editDistDepartamento, setEditDistDepartamento] = useState('');

  const loadConfigData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, dRes] = await Promise.all([
        apiRequest<{ perfiles: Perfil[] }>('/api/admin/perfiles'),
        apiRequest<{ clientes: ClienteItem[] }>('/api/admin/clientes'),
        apiRequest<{ distritos: DistritoItem[] }>('/api/admin/distritos'),
      ]);
      setPerfiles(pRes.perfiles);
      setClientes(cRes.clientes);
      setDistritos(dRes.distritos);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : 'Error cargando los datos de configuración.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfigData();
  }, [loadConfigData]);

  useEffect(() => {
    setNombreSistema(configuracion.nombre_sistema);
    setMargenMinutos(String(configuracion.margen_minutos));
    setPermitirCompartido(configuracion.permitir_cliente_compartido ?? true);
  }, [configuracion]);

  const vendedores = useMemo(
    () => perfiles.filter((p) => p.rol === 'vendedor'),
    [perfiles]
  );

  // Sync selectedVendorId when vendors load
  useEffect(() => {
    if (vendedores.length === 0) {
      setSelectedVendorId('');
      setSelectedVendorClientes([]);
      return;
    }
    const found = vendedores.find((v) => v.id === selectedVendorId) || vendedores[0];
    if (found.id !== selectedVendorId) {
      setSelectedVendorId(found.id);
    }
    setSelectedVendorClientes(found.cartera_clientes || []);
  }, [vendedores, selectedVendorId]);

  const selectedVendor = useMemo(
    () => vendedores.find((v) => v.id === selectedVendorId) || null,
    [vendedores, selectedVendorId]
  );

  const clientOwnersMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const v of vendedores) {
      for (const cName of v.cartera_clientes) {
        const list = map.get(cName) || [];
        list.push(v.nombre);
        map.set(cName, list);
      }
    }
    return map;
  }, [vendedores]);

  // --- Handlers: 1. Parámetros ---
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setOkMsg('');
    const numMargen = Number(margenMinutos);
    if (!Number.isInteger(numMargen) || numMargen < 0 || numMargen > 480) {
      setErrorMsg('El margen de traslado debe ser un número entero entre 0 y 480 minutos.');
      return;
    }

    setSavingCfg(true);
    try {
      await apiRequest('/api/admin/configuracion', {
        method: 'PATCH',
        body: JSON.stringify({
          nombre_sistema: nombreSistema.trim(),
          margen_minutos: numMargen,
          permitir_cliente_compartido: permitirCompartido,
        }),
      });
      setOkMsg('Parámetros del sistema actualizados correctamente.');
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : 'No se pudo guardar la configuración.'
      );
    } finally {
      setSavingCfg(false);
    }
  };

  // --- Handlers: 2. Equipo autorizado ---
  const filteredPerfiles = useMemo(() => {
    const q = normalizeSearch(equipoSearch);
    if (!q) return perfiles;
    return perfiles.filter((p) =>
      normalizeSearch(`${p.nombre} ${p.email} ${p.rol} ${p.especialidad} ${p.celular}`).includes(q)
    );
  }, [perfiles, equipoSearch]);

  const openNewProfile = () => {
    setErrorMsg('');
    setOkMsg('');
    setEditingPerfil(null);
    setPEmail('');
    setPNombre('');
    setPRol('vendedor');
    setPCelular('');
    setPEspecialidad('');
    setPActivo(true);
    setProfileModalOpen(true);
  };

  const openEditProfile = (p: Perfil) => {
    setErrorMsg('');
    setOkMsg('');
    setEditingPerfil(p);
    setPEmail(p.email);
    setPNombre(p.nombre);
    setPRol(p.rol);
    setPCelular(p.celular);
    setPEspecialidad(p.especialidad);
    setPActivo(p.activo);
    setProfileModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setOkMsg('');
    setSavingPerfil(true);
    try {
      if (editingPerfil) {
        await apiRequest(`/api/admin/perfiles/${editingPerfil.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            nombre: pNombre.trim(),
            rol: pRol,
            celular: pCelular.trim(),
            especialidad: pEspecialidad.trim(),
            activo: pActivo,
          }),
        });
        setOkMsg(`Perfil de ${pNombre.trim()} actualizado correctamente.`);
      } else {
        await apiRequest('/api/admin/perfiles', {
          method: 'POST',
          body: JSON.stringify({
            email: pEmail.trim(),
            nombre: pNombre.trim(),
            rol: pRol,
            celular: pCelular.trim(),
            especialidad: pEspecialidad.trim(),
            activo: pActivo,
            cartera_clientes: [],
          }),
        });
        setOkMsg(`Perfil autorizado creado para ${pEmail.trim().toLowerCase()}.`);
      }
      setProfileModalOpen(false);
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo guardar el perfil.');
    } finally {
      setSavingPerfil(false);
    }
  };

  const handleToggleActivoPerfil = async (p: Perfil) => {
    setErrorMsg('');
    setOkMsg('');
    try {
      await apiRequest(`/api/admin/perfiles/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !p.activo }),
      });
      setOkMsg(
        p.activo
          ? `Perfil de ${p.nombre} desactivado. Su historial y reportes previos permanecen intactos.`
          : `Perfil de ${p.nombre} activado nuevamente.`
      );
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo actualizar el estado.');
    }
  };

  const handleDeleteProfile = async (p: Perfil) => {
    setErrorMsg('');
    setOkMsg('');
    try {
      await apiRequest(`/api/admin/perfiles/${p.id}`, { method: 'DELETE' });
      setOkMsg(`Perfil ${p.email} eliminado y solicitudes pendientes resueltas.`);
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo eliminar el perfil.');
    }
  };

  const handleGenerateResetLink = async (p: Perfil) => {
    setErrorMsg('');
    try {
      const res = await apiRequest<{ resetPath: string }>(`/api/admin/perfiles/${p.id}/reset-link`, {
        method: 'POST',
      });
      setResetLinkModal({
        email: p.email,
        url: `${window.location.origin}${res.resetPath}`,
      });
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo generar el enlace.');
    }
  };

  // --- Handlers: 3. Carteras de ejecutivos ---
  const filteredCatalogClients = useMemo(() => {
    const q = normalizeSearch(carteraSearch);
    const activeList = clientes.filter((c) => c.activo);
    const matches = !q
      ? activeList
      : activeList.filter((c) => normalizeSearch(`${c.nombre} ${c.ruc}`).includes(q));
    return matches;
  }, [clientes, carteraSearch]);

  const handleToggleClientInVendor = (clientName: string) => {
    setSelectedVendorClientes((prev) =>
      prev.includes(clientName)
        ? prev.filter((item) => item !== clientName)
        : [...prev, clientName]
    );
  };

  const handleSelectAllFilteredClients = () => {
    const names = filteredCatalogClients.map((c) => c.nombre);
    setSelectedVendorClientes((prev) => Array.from(new Set([...prev, ...names])));
  };

  const handleSaveCartera = async () => {
    if (!selectedVendor) return;
    setErrorMsg('');
    setOkMsg('');
    setSavingCartera(true);
    try {
      const res = await apiRequest<{
        perfil: Perfil;
        addedCount: number;
        removedCount: number;
      }>('/api/admin/carteras', {
        method: 'POST',
        body: JSON.stringify({
          ejecutivo_id: selectedVendor.id,
          clientes: selectedVendorClientes,
        }),
      });
      setOkMsg(
        `Cartera de ${selectedVendor.nombre} guardada (${res.perfil.cartera_clientes.length} clientes; +${res.addedCount} asignados, -${res.removedCount} retirados).`
      );
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo guardar la cartera.');
    } finally {
      setSavingCartera(false);
    }
  };

  const handleAddCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setOkMsg('');
    setAddingCliente(true);
    try {
      const res = await apiRequest<{ cliente: ClienteItem }>('/api/admin/clientes', {
        method: 'POST',
        body: JSON.stringify({
          nombre: newCliNombre.trim(),
          ruc: newCliRuc.trim(),
          sector: 'Cartera MIPERSA',
        }),
      });
      setNewCliNombre('');
      setNewCliRuc('');
      setOkMsg(`Cliente "${res.cliente.nombre}" agregado al catálogo oficial.`);
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo registrar el cliente.');
    } finally {
      setAddingCliente(false);
    }
  };

  // --- Handlers: 4. Catálogo de distritos ---
  const filteredDistritos = useMemo(() => {
    const q = normalizeSearch(distritoSearch);
    if (!q) return distritos;
    return distritos.filter((d) =>
      normalizeSearch(`${d.nombre} ${d.provincia} ${d.departamento}`).includes(q)
    );
  }, [distritos, distritoSearch]);

  const handleAddDistrito = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setOkMsg('');
    setAddingDistrito(true);
    try {
      const res = await apiRequest<{ distrito: DistritoItem }>('/api/admin/distritos', {
        method: 'POST',
        body: JSON.stringify({
          nombre: newDistNombre.trim(),
          provincia: newDistProvincia.trim() || 'Lima',
          departamento: newDistDepartamento.trim() || 'Lima',
          activo: true,
        }),
      });
      setNewDistNombre('');
      setOkMsg(`Distrito "${res.distrito.nombre}" agregado al catálogo oficial.`);
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo agregar el distrito.');
    } finally {
      setAddingDistrito(false);
    }
  };

  const handleSaveEditDistrito = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDistrito) return;
    setErrorMsg('');
    setOkMsg('');
    try {
      await apiRequest(`/api/admin/distritos/${editingDistrito.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: editDistNombre.trim(),
          provincia: editDistProvincia.trim(),
          departamento: editDistDepartamento.trim(),
        }),
      });
      setEditingDistrito(null);
      setOkMsg('Distrito actualizado correctamente.');
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo actualizar el distrito.');
    }
  };

  const handleToggleDistrito = async (d: DistritoItem) => {
    setErrorMsg('');
    setOkMsg('');
    try {
      await apiRequest(`/api/admin/distritos/${d.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !d.activo }),
      });
      setOkMsg(
        d.activo
          ? `Distrito "${d.nombre}" desactivado para nuevas solicitudes (las visitas históricas se mantienen intactas).`
          : `Distrito "${d.nombre}" activado en el catálogo.`
      );
      await Promise.all([loadConfigData(), onRefresh()]);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'No se pudo actualizar el distrito.');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">
          Configuración del Sistema
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Administración de parámetros operativos, equipo autorizado, carteras comerciales y catálogo de distritos.
        </p>
      </div>

      {/* Section Switcher */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/80 overflow-x-auto">
        {(
          [
            { id: 'parametros', label: '1. Parámetros del sistema', icon: Settings },
            { id: 'equipo', label: '2. Equipo autorizado', icon: Users },
            { id: 'carteras', label: '3. Carteras de ejecutivos', icon: Briefcase },
            { id: 'distritos', label: '4. Catálogo de distritos', icon: MapPin },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setErrorMsg('');
                setOkMsg('');
                setSection(item.id);
              }}
              className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 text-sm flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {okMsg && (
        <div
          role="status"
          className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-sm flex items-start gap-2"
        >
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{okMsg}</span>
        </div>
      )}

      {/* APARTADO 1: PARÁMETROS DEL SISTEMA */}
      {section === 'parametros' && (
        <form
          onSubmit={handleSaveConfig}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 max-w-2xl space-y-5"
        >
          <div>
            <h2 className="font-heading text-lg font-bold text-slate-900 dark:text-white">
              Parámetros generales de operación
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Define la identidad visible del portal y las reglas de validación automática de agenda y carteras.
            </p>
          </div>

          <div>
            <label
              htmlFor="cfg-nombre"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Nombre del sistema
            </label>
            <input
              id="cfg-nombre"
              type="text"
              required
              value={nombreSistema}
              onChange={(e) => setNombreSistema(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-margen"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Margen de traslado entre visitas (minutos)
            </label>
            <input
              id="cfg-margen"
              type="number"
              min={0}
              max={480}
              required
              value={margenMinutos}
              onChange={(e) => setMargenMinutos(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 selectable-text">
              Rango permitido: 0 a 480 minutos (predeterminado: 60 min). Este margen se suma antes de la hora de salida y después de la hora de retorno de cada visita aceptada al comprobar conflictos de agenda y evitar traslapes de traslado.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={permitirCompartido}
                onChange={(e) => setPermitirCompartido(e.target.checked)}
                className="w-4 h-4 mt-1 accent-[#C8102E]"
              />
              <div>
                <span className="block text-sm font-medium text-slate-900 dark:text-white">
                  Permitir clientes compartidos entre múltiples ejecutivos de ventas
                </span>
                <span className="block text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Si se desactiva, el servidor impedirá asignar un mismo cliente a más de un ejecutivo comercial simultáneamente.
                </span>
              </div>
            </label>
          </div>

          <button
            type="submit"
            disabled={savingCfg}
            className="min-h-[44px] px-5 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{savingCfg ? 'Guardando...' : 'Guardar parámetros'}</span>
          </button>
        </form>
      )}

      {/* APARTADO 2: EQUIPO AUTORIZADO */}
      {section === 'equipo' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Los asesores técnicos marcados como <strong>Inactivos</strong> no aparecen como opción en nuevas solicitudes ni reciben nuevas asignaciones. Desactivar un perfil bloquea su acceso funcional sin eliminar su historial, reportes ni solicitudes previas.
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={equipoSearch}
                onChange={(e) => setEquipoSearch(e.target.value)}
                placeholder="Buscar colaborador por nombre, correo o rol..."
                className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={openNewProfile}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium inline-flex items-center justify-center gap-2 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Agregar perfil autorizado</span>
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {loading && perfiles.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">Cargando equipo autorizado...</div>
            ) : filteredPerfiles.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 text-center">
                No hay colaboradores que coincidan con la búsqueda.
              </div>
            ) : (
              filteredPerfiles.map((p) => (
                <div
                  key={p.id}
                  className="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{p.nombre}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs font-medium text-[#C8102E] dark:text-red-400">
                        <RolLabel rol={p.rol} />
                      </span>
                      <span className="text-xs text-slate-400">·</span>
                      <span
                        className={`text-xs font-medium ${
                          p.activo
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-400 line-through'
                        }`}
                      >
                        {p.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                      {p.email}
                      {p.celular ? ` · Cel: ${p.celular}` : ''}
                      {p.especialidad ? ` · ${p.especialidad}` : ''}
                    </p>
                    {p.rol === 'vendedor' && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Cartera asignada:{' '}
                        <span className="font-mono">{p.cartera_clientes.length}</span> clientes
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditProfile(p)}
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </button>

                    {p.id !== currentProfile.id && (
                      <button
                        type="button"
                        onClick={() => handleToggleActivoPerfil(p)}
                        className={`min-h-[40px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 ${
                          p.activo
                            ? 'border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                            : 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                        }`}
                      >
                        {p.activo ? (
                          <>
                            <UserX className="w-3.5 h-3.5" />
                            <span>Desactivar</span>
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Activar</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleGenerateResetLink(p)}
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Enlace clave</span>
                    </button>

                    {p.id !== currentProfile.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(p)}
                        className="min-h-[40px] px-3 rounded-lg border border-red-200 dark:border-red-900/60 text-xs font-medium text-red-700 dark:text-red-400 inline-flex items-center gap-1 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* APARTADO 3: CARTERAS DE EJECUTIVOS */}
      {section === 'carteras' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Asigna o retira clientes de la cartera de cada Ejecutivo de ventas. Al retirar un cliente de una cartera, los ejecutivos no podrán usarlo en nuevas solicitudes, pero las visitas y reportes históricos mantienen su registro original. Regla actual:{' '}
            <strong className="text-slate-900 dark:text-white">
              {permitirCompartido
                ? 'Clientes compartidos permitidos entre ejecutivos'
                : 'Cartera exclusiva (sin clientes duplicados entre ejecutivos)'}
            </strong>
            .
          </div>

          {/* Agregar nuevo cliente al catálogo general */}
          <form
            onSubmit={handleAddCliente}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Agregar nueva razón social al catálogo MIPERSA
              </label>
              <input
                type="text"
                required
                value={newCliNombre}
                onChange={(e) => setNewCliNombre(e.target.value)}
                placeholder="Ej. COMPAÑIA MINERA HORIZONTE S.A."
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                RUC (opcional)
              </label>
              <input
                type="text"
                value={newCliRuc}
                onChange={(e) => setNewCliRuc(e.target.value)}
                placeholder="20123456789"
                className="w-full min-h-[44px] px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={addingCliente}
              className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{addingCliente ? 'Agregando...' : 'Agregar cliente'}</span>
            </button>
          </form>

          {vendedores.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500">
              No hay perfiles con rol Ejecutivo de ventas registrados.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              {/* Selector de ejecutivo */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
                <h2 className="font-heading text-sm font-bold text-slate-900 dark:text-white">
                  Seleccionar ejecutivo de ventas
                </h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {vendedores.map((v) => {
                    const active = v.id === selectedVendorId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelectedVendorId(v.id);
                          setSelectedVendorClientes(v.cartera_clientes || []);
                          setErrorMsg('');
                          setOkMsg('');
                        }}
                        className={`w-full min-h-[48px] px-3 py-2.5 text-left rounded-lg transition-colors flex items-center justify-between gap-2 my-0.5 ${
                          active
                            ? 'bg-[#C8102E]/10 text-[#C8102E] dark:text-red-400 font-medium'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm truncate">{v.nombre}</p>
                          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                            {v.email} {!v.activo ? '· Inactivo' : ''}
                          </p>
                        </div>
                        <span className="font-mono text-xs shrink-0">
                          {v.cartera_clientes.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Editor de cartera del ejecutivo seleccionado */}
              {selectedVendor && (
                <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div>
                      <h2 className="font-heading text-base font-bold text-slate-900 dark:text-white">
                        Cartera de {selectedVendor.nombre}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">
                          {selectedVendorClientes.length}
                        </span>{' '}
                        clientes seleccionados en esta cartera
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveCartera}
                      disabled={savingCartera}
                      className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingCartera ? 'Guardando...' : 'Guardar cartera'}</span>
                    </button>
                  </div>

                  {/* Assigned quick list */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Clientes actualmente asignados ({selectedVendorClientes.length})
                      </span>
                      {selectedVendorClientes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedVendorClientes([])}
                          className="text-xs text-red-700 dark:text-red-400 hover:underline"
                        >
                          Retirar todos
                        </button>
                      )}
                    </div>
                    {selectedVendorClientes.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                        Este ejecutivo no tiene clientes asignados en su cartera. Marca clientes abajo y guarda los cambios.
                      </p>
                    ) : (
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedVendorClientes.map((cName) => (
                          <div
                            key={cName}
                            className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-slate-800 dark:text-slate-200 truncate">
                              {cName}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleToggleClientInVendor(cName)}
                              className="text-red-700 dark:text-red-400 hover:underline shrink-0 font-medium"
                            >
                              Retirar
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Catalog multi-select search */}
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          value={carteraSearch}
                          onChange={(e) => setCarteraSearch(e.target.value)}
                          placeholder="Buscar cliente por razón social en el catálogo MIPERSA..."
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                        />
                      </div>
                      {carteraSearch.trim() && filteredCatalogClients.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSelectAllFilteredClients}
                          className="min-h-[44px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
                        >
                          Asignar coincidencias ({filteredCatalogClients.length})
                        </button>
                      )}
                    </div>

                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredCatalogClients.length === 0 ? (
                        <div className="p-4 text-xs text-slate-500 text-center">
                          No se encontraron clientes con ese criterio.
                        </div>
                      ) : (
                        filteredCatalogClients.map((c) => {
                          const checked = selectedVendorClientes.includes(c.nombre);
                          const otherOwners = (clientOwnersMap.get(c.nombre) || []).filter(
                            (ownerName) => ownerName !== selectedVendor.nombre
                          );
                          return (
                            <label
                              key={c.id}
                              className="flex items-start gap-2.5 px-3 py-2.5 min-h-[44px] text-xs sm:text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/70"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleClientInVendor(c.nombre)}
                                className="w-4 h-4 mt-0.5 accent-[#C8102E] shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <span className="block text-slate-800 dark:text-slate-200">
                                  {c.nombre}
                                </span>
                                {otherOwners.length > 0 && (
                                  <span className="block text-[11px] text-amber-700 dark:text-amber-400">
                                    También en cartera de: {otherOwners.join(', ')}
                                  </span>
                                )}
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* APARTADO 4: CATÁLOGO DE DISTRITOS */}
      {section === 'distritos' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Administra los distritos oficiales disponibles al registrar nuevas solicitudes. Desactivar un distrito evita su selección futura sin alterar ni perder los distritos guardados en visitas anteriores.
          </div>

          <form
            onSubmit={handleAddDistrito}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Nombre del distrito
              </label>
              <input
                type="text"
                required
                value={newDistNombre}
                onChange={(e) => setNewDistNombre(e.target.value)}
                placeholder="Ej. CHILCA"
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Provincia
              </label>
              <input
                type="text"
                required
                value={newDistProvincia}
                onChange={(e) => setNewDistProvincia(e.target.value)}
                placeholder="Lima"
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Departamento
              </label>
              <input
                type="text"
                required
                value={newDistDepartamento}
                onChange={(e) => setNewDistDepartamento(e.target.value)}
                placeholder="Lima"
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={addingDistrito}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{addingDistrito ? 'Agregando...' : 'Agregar distrito'}</span>
            </button>
          </form>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={distritoSearch}
                onChange={(e) => setDistritoSearch(e.target.value)}
                placeholder="Buscar distrito por nombre o provincia..."
                className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {distritos.filter((d) => d.activo).length} activos / {distritos.length} total
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {filteredDistritos.map((d) => (
              <div
                key={d.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div>
                  <p
                    className={`font-medium text-sm ${
                      d.activo
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-400 line-through'
                    }`}
                  >
                    {d.nombre}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {d.provincia}, {d.departamento}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDistrito(d);
                      setEditDistNombre(d.nombre);
                      setEditDistProvincia(d.provincia);
                      setEditDistDepartamento(d.departamento);
                    }}
                    className="min-h-[40px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleDistrito(d)}
                    className={`min-h-[40px] px-3 rounded-lg border text-xs font-medium ${
                      d.activo
                        ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                        : 'border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {d.activo ? 'Activo' : 'Inactivo'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Crear / Editar Perfil */}
      {profileModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveProfile}
            className="w-full max-w-xl max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-heading text-lg font-bold text-slate-900 dark:text-white">
                {editingPerfil ? `Editar perfil: ${editingPerfil.email}` : 'Nuevo perfil autorizado'}
              </h3>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-4 flex-1">
              {!editingPerfil && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Correo electrónico autorizado
                  </label>
                  <input
                    type="email"
                    required
                    value={pEmail}
                    onChange={(e) => setPEmail(e.target.value)}
                    placeholder="colaborador@mipersa.pe o usuario@gmail.com"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Puedes autorizar correos @mipersa.pe o de otros dominios (ej. @gmail.com).
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    required
                    value={pNombre}
                    onChange={(e) => setPNombre(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Rol funcional
                  </label>
                  <select
                    value={pRol}
                    onChange={(e) => setPRol(e.target.value as UserRole)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    <option value="vendedor">Ejecutivo de ventas</option>
                    <option value="tecnico">Asesor técnico</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Celular (contacto / WhatsApp)
                  </label>
                  <input
                    type="tel"
                    value={pCelular}
                    onChange={(e) => setPCelular(e.target.value)}
                    placeholder="999888777"
                    className="w-full min-h-[44px] px-3.5 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Especialidad / Área
                  </label>
                  <input
                    type="text"
                    value={pEspecialidad}
                    onChange={(e) => setPEspecialidad(e.target.value)}
                    placeholder="Ej. Sistemas Hidráulicos"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={pActivo}
                  onChange={(e) => setPActivo(e.target.checked)}
                  className="w-4 h-4 accent-[#C8102E]"
                />
                <span>Perfil activo (habilitado para operar y aparecer en asignaciones)</span>
              </label>

              {pRol === 'vendedor' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  La cartera de clientes de este ejecutivo se administra en la pestaña{' '}
                  <strong>3. Carteras de ejecutivos</strong>.
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5 safe-bottom">
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingPerfil}
                className="min-h-[44px] px-5 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium disabled:opacity-50"
              >
                {savingPerfil ? 'Guardando...' : 'Guardar perfil'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Editar Distrito */}
      {editingDistrito && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveEditDistrito}
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-slate-900 dark:text-white">
                Editar distrito
              </h3>
              <button
                type="button"
                onClick={() => setEditingDistrito(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nombre del distrito
              </label>
              <input
                type="text"
                required
                value={editDistNombre}
                onChange={(e) => setEditDistNombre(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Provincia
                </label>
                <input
                  type="text"
                  required
                  value={editDistProvincia}
                  onChange={(e) => setEditDistProvincia(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Departamento
                </label>
                <input
                  type="text"
                  required
                  value={editDistDepartamento}
                  onChange={(e) => setEditDistDepartamento(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 safe-bottom">
              <button
                type="button"
                onClick={() => setEditingDistrito(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] hover:bg-[#A50D26] text-white text-sm font-medium"
              >
                Guardar cambios
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Admin Password Reset Link */}
      {resetLinkModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="font-heading text-lg font-bold text-slate-900 dark:text-white">
              Enlace de restablecimiento generado
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              Comparte este enlace privado con <strong>{resetLinkModal.email}</strong> (válido por 60 minutos):
            </p>
            <input
              type="text"
              readOnly
              value={resetLinkModal.url}
              onClick={(e) => e.currentTarget.select()}
              className="w-full min-h-[44px] px-3 py-2 font-mono text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setResetLinkModal(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-[#C8102E] text-white text-sm font-medium"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
