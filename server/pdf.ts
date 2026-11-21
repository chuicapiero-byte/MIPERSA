import fs from 'fs';
import PDFDocument from 'pdfkit';
import { UPLOAD_DIR, db } from './db.ts';
import { resolveSafeUploadPath } from './security.ts';

const RED = '#B91C1C';
const BLACK = '#111827';
const MUTED = '#4B5563';
const BORDER = '#D1D5DB';
const BG_SOFT = '#F8FAFC';

interface ReportPdfInput {
  solicitud: {
    codigo: string;
    cliente: string;
    distrito: string;
    fecha: string;
    hora_salida: string;
    hora_retorno: string;
    motivo: string;
    motivo_otro: string;
    tecnico_nombre: string;
    ejecutivo_nombre: string;
    ejecutivo_email: string;
    contacto_nombre: string;
    contacto_cargo: string;
    contacto_celular: string;
    descripcion: string;
  };
  reporte: {
    actividades: string[];
    recomendaciones: string;
    pendientes: string;
    imagenes_actividades: Array<{ id: string; name: string }>;
    imagenes_recomendaciones: Array<{ id: string; name: string }>;
    imagenes_pendientes: Array<{ id: string; name: string }>;
    fecha_culminacion: string;
    hora_culminacion: string;
    autor_email: string;
  };
  nombreSistema: string;
}

function loadPrivateImageBuffer(fileId: string): Buffer | null {
  const row = db
    .prepare('SELECT storage_name, mime_type FROM archivos WHERE id = ?')
    .get(fileId) as { storage_name: string; mime_type: string } | undefined;
  if (!row) return null;
  if (row.mime_type !== 'image/jpeg' && row.mime_type !== 'image/png') return null;
  try {
    const filePath = resolveSafeUploadPath(UPLOAD_DIR, row.storage_name);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function getImageDimensions(buf: Buffer): { width: number; height: number } {
  // PNG: bytes 16..23 contain big-endian width and height
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  // JPEG: scan SOF0..SOF2 markers
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return {
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        };
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const segLen = buf.readUInt16BE(i + 2);
      if (segLen < 2) break;
      i += 2 + segLen;
    }
  }
  return { width: 800, height: 600 };
}

export async function generateVisitReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 82, bottom: 64, left: 46, right: 46 },
      bufferPages: true,
      info: {
        Title: `Reporte de Visita ${input.solicitud.codigo} - MIPERSA`,
        Author: input.reporte.autor_email,
        Subject: `Informe Técnico de Visita Comercial - ${input.solicitud.cliente}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const right = pageWidth - doc.page.margins.right;
    const contentWidth = right - left;
    const contentBottom = pageHeight - doc.page.margins.bottom - 8;

    const drawHeaderOnPage = () => {
      // Corporate Red accent top rule
      doc.save();
      doc.rect(0, 0, pageWidth, 6).fill(RED);

      // Corporate MIPERSA emblem mark
      doc.rect(left, 20, 26, 26).fill(RED);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14).text('M', left + 6.5, 26, {
        lineBreak: false,
      });

      doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(13).text('MIPERSA', left + 34, 21, {
        lineBreak: false,
      });
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8.5).text(
        'INFORME TÉCNICO DE VISITA COMERCIAL',
        left + 34,
        36,
        { lineBreak: false }
      );

      // Right side code & date
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(11).text(
        input.solicitud.codigo,
        left,
        21,
        { width: contentWidth, align: 'right', lineBreak: false }
      );
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(
        `Fecha de visita: ${input.solicitud.fecha}`,
        left,
        36,
        { width: contentWidth, align: 'right', lineBreak: false }
      );

      doc.moveTo(left, 56).lineTo(right, 56).lineWidth(0.8).strokeColor(BORDER).stroke();
      doc.restore();
    };

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > contentBottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
    };

    const drawSectionTitle = (title: string) => {
      ensureSpace(34);
      doc.moveDown(0.5);
      const y = doc.y;
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(11).text(title.toUpperCase(), left, y);
      doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).lineWidth(1).strokeColor(RED).stroke();
      doc.y += 10;
    };

    const drawTwoColumnField = (
      labelLeft: string,
      valueLeft: string,
      labelRight: string,
      valueRight: string
    ) => {
      const colGap = 16;
      const colW = (contentWidth - colGap) / 2;

      doc.font('Helvetica-Bold').fontSize(8.5);
      const lH1 = doc.heightOfString(labelLeft, { width: colW });
      const lH2 = doc.heightOfString(labelRight, { width: colW });
      doc.font('Helvetica').fontSize(9.5);
      const vH1 = doc.heightOfString(valueLeft || '—', { width: colW });
      const vH2 = doc.heightOfString(valueRight || '—', { width: colW });

      const rowH = Math.max(lH1 + vH1, lH2 + vH2) + 8;
      ensureSpace(rowH);

      const startY = doc.y;
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8.5).text(labelLeft, left, startY, { width: colW });
      doc.fillColor(BLACK).font('Helvetica').fontSize(9.5).text(valueLeft || '—', left, startY + 12, {
        width: colW,
      });

      const rightX = left + colW + colGap;
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8.5).text(labelRight, rightX, startY, { width: colW });
      doc.fillColor(BLACK).font('Helvetica').fontSize(9.5).text(valueRight || '—', rightX, startY + 12, {
        width: colW,
      });

      doc.y = startY + rowH;
    };

    const renderImageGrid = (images: Array<{ id: string; name: string }>) => {
      const loaded = images
        .map((img) => ({ ...img, buf: loadPrivateImageBuffer(img.id) }))
        .filter((img): img is { id: string; name: string; buf: Buffer } => img.buf !== null);

      if (loaded.length === 0) return;

      const gap = 12;
      const cellW = (contentWidth - gap) / 2;
      const maxCellH = 165;

      for (let i = 0; i < loaded.length; i += 2) {
        const pair = loaded.slice(i, i + 2);

        const boxes = pair.map((item) => {
          const dims = getImageDimensions(item.buf);
          const ratio = dims.width > 0 && dims.height > 0 ? dims.width / dims.height : 4 / 3;
          let drawW = cellW;
          let drawH = drawW / ratio;
          if (drawH > maxCellH) {
            drawH = maxCellH;
            drawW = drawH * ratio;
          }
          return { item, drawW, drawH };
        });

        const rowImgHeight = Math.max(...boxes.map((b) => b.drawH));
        const captionH = 16;
        const totalRowHeight = rowImgHeight + captionH + 10;

        ensureSpace(totalRowHeight);
        const rowTop = doc.y + 4;

        boxes.forEach((box, idx) => {
          const x = left + idx * (cellW + gap);
          const frameY = rowTop;
          // Subtle container frame keeping proportional image centered
          doc.save();
          doc
            .rect(x, frameY, cellW, rowImgHeight + 4)
            .fillAndStroke(BG_SOFT, BORDER);

          const imgX = x + (cellW - box.drawW) / 2;
          const imgY = frameY + (rowImgHeight + 4 - box.drawH) / 2;
          try {
            doc.image(box.item.buf, imgX, imgY, {
              width: box.drawW,
              height: box.drawH,
            });
          } catch {
            // Fallback label if image buffer cannot be decoded
            doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(
              'Imagen adjunta no decodificable',
              x + 8,
              frameY + rowImgHeight / 2
            );
          }

          doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(
            box.item.name,
            x,
            frameY + rowImgHeight + 7,
            { width: cellW, align: 'center', ellipsis: true, lineBreak: false }
          );
          doc.restore();
        });

        doc.y = rowTop + totalRowHeight;
      }
    };

    // Start Page 1 content
    doc.y = doc.page.margins.top;

    // Resumen de la visita
    drawSectionTitle('1. Datos Generales de la Visita');

    const motivoCompleto =
      input.solicitud.motivo === 'Otro' && input.solicitud.motivo_otro
        ? `Otro: ${input.solicitud.motivo_otro}`
        : input.solicitud.motivo;

    drawTwoColumnField(
      'CLIENTE',
      input.solicitud.cliente,
      'DISTRITO',
      input.solicitud.distrito
    );
    drawTwoColumnField(
      'FECHA Y HORARIO PROGRAMADO',
      `${input.solicitud.fecha}  |  ${input.solicitud.hora_salida} – ${input.solicitud.hora_retorno}`,
      'FECHA Y HORA DE CULMINACIÓN',
      `${input.reporte.fecha_culminacion}  |  ${input.reporte.hora_culminacion}`
    );
    drawTwoColumnField(
      'TÉCNICO ASIGNADO',
      input.solicitud.tecnico_nombre,
      'EJECUTIVO COMERCIAL',
      `${input.solicitud.ejecutivo_nombre} (${input.solicitud.ejecutivo_email})`
    );
    drawTwoColumnField(
      'CONTACTO EN CLIENTE',
      `${input.solicitud.contacto_nombre} — ${input.solicitud.contacto_cargo}`,
      'TELÉFONO DE CONTACTO',
      input.solicitud.contacto_celular
    );
    drawTwoColumnField('MOTIVO DE VISITA', motivoCompleto, 'AUTOR DEL REPORTE', input.reporte.autor_email);

    if (input.solicitud.descripcion) {
      ensureSpace(36);
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8.5).text('DESCRIPCIÓN INICIAL DE LA SOLICITUD', left, doc.y);
      doc.y += 12;
      doc.fillColor(BLACK).font('Helvetica').fontSize(9.5).text(input.solicitud.descripcion, left, doc.y, {
        width: contentWidth,
        align: 'justify',
      });
      doc.moveDown(0.5);
    }

    // Sección 2: Actividades Realizadas
    drawSectionTitle('2. Actividades Realizadas');
    const actividades = input.reporte.actividades.filter((a) => a.trim().length > 0);
    if (actividades.length === 0) {
      doc.fillColor(BLACK).font('Helvetica').fontSize(9.5).text('Sin actividades registradas.', left, doc.y, {
        width: contentWidth,
        align: 'justify',
      });
    } else {
      actividades.forEach((act, idx) => {
        const text = `${idx + 1}. ${act.trim()}`;
        doc.font('Helvetica').fontSize(9.5);
        const h = doc.heightOfString(text, { width: contentWidth, align: 'justify' });
        ensureSpace(h + 8);
        doc.fillColor(BLACK).text(text, left, doc.y, {
          width: contentWidth,
          align: 'justify',
        });
        doc.y += 4;
      });
    }
    renderImageGrid(input.reporte.imagenes_actividades);

    // Sección 3: Recomendaciones
    drawSectionTitle('3. Recomendaciones');
    const recText = (input.reporte.recomendaciones || '').trim() || 'Sin recomendaciones adicionales registradas.';
    doc.font('Helvetica').fontSize(9.5);
    ensureSpace(doc.heightOfString(recText, { width: contentWidth, align: 'justify' }) + 12);
    doc.fillColor(BLACK).text(recText, left, doc.y, {
      width: contentWidth,
      align: 'justify',
    });
    doc.moveDown(0.4);
    renderImageGrid(input.reporte.imagenes_recomendaciones);

    // Sección 4: Pendientes
    drawSectionTitle('4. Pendientes y Próximos Pasos');
    const pendText = (input.reporte.pendientes || '').trim() || 'No se registran pendientes abiertos al cierre de la visita.';
    doc.font('Helvetica').fontSize(9.5);
    ensureSpace(doc.heightOfString(pendText, { width: contentWidth, align: 'justify' }) + 12);
    doc.fillColor(BLACK).text(pendText, left, doc.y, {
      width: contentWidth,
      align: 'justify',
    });
    doc.moveDown(0.4);
    renderImageGrid(input.reporte.imagenes_pendientes);

    // Draw consistent headers & footers with accurate page numbering across all buffered pages
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      drawHeaderOnPage();

      const footerY = pageHeight - doc.page.margins.bottom + 8;
      doc.save();
      doc.moveTo(left, footerY - 6).lineTo(right, footerY - 6).lineWidth(0.6).strokeColor(BORDER).stroke();

      const footerDisclaimer =
        `${input.nombreSistema} · Reporte emitido para seguimiento comercial y técnico de MIPERSA. La información contenida es de carácter confidencial.`;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(footerDisclaimer, left, footerY, {
        width: contentWidth - 76,
        align: 'justify',
      });

      doc.fillColor(RED).font('Helvetica-Bold').fontSize(8).text(
        `Página ${p + 1} de ${range.count}`,
        right - 70,
        footerY + 1,
        { width: 70, align: 'right', lineBreak: false }
      );
      doc.restore();
    }

    doc.end();
  });
}
