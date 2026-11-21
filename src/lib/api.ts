import type { FileRef } from '../types.ts';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'MIPERSA-SPA');
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string'
          ? data.message
          : `Error del servidor (${res.status})`;
    throw new ApiError(msg, res.status, typeof data.code === 'string' ? data.code : undefined);
  }

  return data as T;
}

async function normalizeImageToJpegOrPng(file: File): Promise<File> {
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    return file;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxDim = 1600;
        let w = img.naturalWidth || 1200;
        let h = img.naturalHeight || 900;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('No se pudo procesar la imagen seleccionada.'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              reject(new Error('No se pudo convertir la imagen a JPEG.'));
              return;
            }
            const cleanName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
            resolve(new File([blob], cleanName, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.88
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`El archivo "${file.name}" no es una imagen compatible.`));
    };
    img.src = url;
  });
}

export async function uploadPrivateImages(
  files: File[],
  entityType: 'solicitud' | 'reporte',
  entityId = ''
): Promise<FileRef[]> {
  if (files.length === 0) return [];
  const normalizedFiles = await Promise.all(files.map(normalizeImageToJpegOrPng));

  const formData = new FormData();
  formData.append('entityType', entityType);
  if (entityId) formData.append('entityId', entityId);
  for (const f of normalizedFiles) {
    formData.append('files', f);
  }

  const res = await apiRequest<{ files: FileRef[] }>('/api/files/upload', {
    method: 'POST',
    body: formData,
  });
  return res.files;
}
