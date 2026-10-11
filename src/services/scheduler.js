import { prisma } from '../lib/prisma.js';
import { dispatch } from './notification.service.js';

const REMINDERS = [
  { type: 'REMINDER_24H', ms: 24 * 60 * 60 * 1000, flag: 'reminder24h' },
  { type: 'REMINDER_1H',  ms:      60 * 60 * 1000, flag: 'reminder1h'  },
];

// Se llama una vez por invocación (la dispara un cron EXTERNO, ver src/routes/internal.routes.js).
// Busca citas confirmadas que ya entraron en la ventana del recordatorio y aún no tienen
// aviso registrado. Si el servicio estuvo dormido/caído, el pendiente se envía en la
// siguiente invocación mientras la cita no haya empezado — no se pierde.
export async function runReminders() {
  const now = new Date();
  let sent = 0;

  for (const r of REMINDERS) {
    const due = await prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED',
        startsAt: { gt: now, lte: new Date(now.getTime() + r.ms) },
        psychologist: { [r.flag]: true },
        notifications: { none: { type: r.type } },
      },
      select: { id: true },
      take: 200,
    });
    for (const a of due) {
      await dispatch(a.id, r.type).catch(err => console.error('[scheduler]', r.type, a.id, err.message));
      sent++;
    }
  }

  await prisma.appointment.updateMany({
    where: { status: 'REQUESTED', startsAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });

  return { checked: REMINDERS.length, remindersSent: sent };
}

// --- Modo alternativo, por si en algún momento SÍ tienes un proceso siempre vivo ---
// (Render Starter, Railway, una VM propia). Actívalo con RUN_SCHEDULER_INPROCESS=true.
export async function startInProcessScheduler() {
  const cron = await import('node-cron');
  let running = false;
  cron.default.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try { await runReminders(); } catch (e) { console.error('[scheduler]', e); }
    finally { running = false; }
  });
  console.log('[scheduler] modo in-process activo (cron interno cada minuto)');
}
