import { prisma } from '../lib/prisma.js';
import { formatHuman } from '../lib/time.js';
import { sendWhatsAppTemplate, TEMPLATES } from './whatsapp.service.js';
import { sendEmail } from './email.service.js';

const REMINDER_LABEL = { REMINDER_24H: '24 horas', REMINDER_1H: '1 hora' };

function buildContent(type, recipient, a) {
  const tz = a.psychologist.timezone;
  const { fecha, hora } = formatHuman(a.startsAt, tz);
  const isPatient = recipient === 'PATIENT';
  const me = isPatient ? a.patient.name : a.psychologist.name;
  const other = isPatient ? `Psic. ${a.psychologist.name}` : a.patient.name;

  const params = [me, other, fecha, hora, a.modality];
  let template, subject, text;

  if (type === 'CONFIRMED') {
    template = isPatient ? TEMPLATES.CONFIRMED_PATIENT : TEMPLATES.CONFIRMED_PSYCHOLOGIST;
    subject = isPatient ? 'Tu cita ha sido confirmada' : 'Nueva sesión confirmada';
    text = isPatient
      ? `Hola ${me}, tu cita con ${other} fue confirmada.\n\nFecha: ${fecha}\nHora: ${hora}\nModalidad: ${a.modality}\nDuración: ${a.psychologist.slotMinutes} minutos\n\nRecibirás un recordatorio antes de tu sesión.`
      : `Tienes una nueva sesión confirmada.\n\nPaciente: ${a.patient.name}\nFecha: ${fecha}\nHora: ${hora}\nModalidad: ${a.modality}`;
  } else {
    template = TEMPLATES[type];
    subject = `Recordatorio: tu cita es en ${REMINDER_LABEL[type]}`;
    text = `Hola ${me}, te recordamos tu cita con ${other} en ${REMINDER_LABEL[type]}.\n\nFecha: ${fecha}\nHora: ${hora}\nModalidad: ${a.modality}`;
  }
  return { template, params, subject, text };
}

function targets(a, recipient) {
  const isPatient = recipient === 'PATIENT';
  const p = isPatient ? a.patient : a.psychologist;
  return {
    email: p.email && (isPatient ? true : a.psychologist.notifyEmail) ? p.email : null,
    // WhatsApp al paciente solo con consentimiento explícito (opt-in)
    phone: p.phone && (isPatient ? a.patient.whatsappOptIn : a.psychologist.notifyWhatsapp) ? p.phone : null,
  };
}

/**
 * Envía la notificación `type` de una cita a paciente y psicólogo por WhatsApp y email.
 * Idempotente: el @@unique de NotificationLog evita duplicados aunque el scheduler
 * corra dos veces o el endpoint se llame de nuevo.
 */
export async function dispatch(appointmentId, type) {
  const a = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true, psychologist: true },
  });
  if (!a || a.status !== 'CONFIRMED') return;

  for (const recipient of ['PATIENT', 'PSYCHOLOGIST']) {
    const { email, phone } = targets(a, recipient);
    const content = buildContent(type, recipient, a);

    for (const [channel, dest] of [['WHATSAPP', phone], ['EMAIL', email]]) {
      if (!dest) continue;

      // "Reclamar" el envío: si ya existe el registro, otro proceso/ejecución ya lo hizo.
      let log;
      try {
        log = await prisma.notificationLog.create({
          data: { appointmentId, recipient, channel, type },
        });
      } catch (e) {
        if (e.code === 'P2002') continue;
        throw e;
      }

      try {
        const providerId = channel === 'WHATSAPP'
          ? await sendWhatsAppTemplate({ to: dest, template: content.template, params: content.params })
          : await sendEmail({ to: dest, subject: content.subject, text: content.text });
        await prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: 'SENT', sentAt: new Date(), providerMessageId: providerId ?? null },
        });
      } catch (err) {
        await prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: 'FAILED', error: String(err.message).slice(0, 500) },
        });
      }
    }
  }
}
