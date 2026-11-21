import nodemailer from 'nodemailer';

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
  );
}

export interface EmailDispatchResult {
  sent: boolean;
  reason?: 'SMTP_NOT_CONFIGURED' | 'DELIVERY_FAILED';
  detail: string;
  messageId?: string;
}

export async function sendCorporateEmail(params: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<EmailDispatchResult> {
  const recipients = Array.from(
    new Set(
      params.to
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'))
    )
  );

  if (recipients.length === 0) {
    return {
      sent: false,
      reason: 'DELIVERY_FAILED',
      detail: 'No se especificaron destinatarios válidos.',
    };
  }

  if (!isSmtpConfigured()) {
    return {
      sent: false,
      reason: 'SMTP_NOT_CONFIGURED',
      detail:
        'El servidor SMTP no está configurado (variables SMTP_HOST, SMTP_USER, SMTP_PASS). El registro fue guardado en el sistema, pero no se confirmó ningún envío de correo.',
    };
  }

  try {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const from = process.env.SMTP_FROM || `Gestor de Visitas MIPERSA <${process.env.SMTP_USER}>`;

    const info = await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });

    return {
      sent: true,
      detail: `Correo enviado correctamente a ${recipients.join(', ')}.`,
      messageId: info.messageId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al enviar correo';
    return {
      sent: false,
      reason: 'DELIVERY_FAILED',
      detail: `No se pudo confirmar el envío de correo: ${msg}`,
    };
  }
}
