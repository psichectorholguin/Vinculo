import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';
import { dispatch } from '../services/notification.service.js';

export const appointmentsRouter = Router();
appointmentsRouter.use(requirePsychologist);

// GET /appointments?status=REQUESTED
appointmentsRouter.get('/', async (req, res) => {
  const where = { psychologistId: req.user.psychologistId };
  if (req.query.status) where.status = String(req.query.status);
  const items = await prisma.appointment.findMany({
    where, orderBy: { startsAt: 'asc' }, take: 200,
    include: { patient: { select: { id: true, name: true } } },   // sin datos de contacto innecesarios
  });
  res.json(items);
});

// Transición controlada por el backend: solo REQUESTED -> CONFIRMED/REJECTED,
// y solo sobre citas del psicólogo autenticado (ownership en el WHERE).
async function transition(req, res, from, to, extra = {}) {
  const { count } = await prisma.appointment.updateMany({
    where: { id: req.params.id, psychologistId: req.user.psychologistId, status: { in: from } },
    data: { status: to, ...extra },
  });
  if (count === 0) return res.status(409).json({ error: 'La cita no existe o no se puede cambiar de estado' });
  return null;
}

appointmentsRouter.post('/:id/confirm', async (req, res) => {
  if (await transition(req, res, ['REQUESTED'], 'CONFIRMED', { confirmedAt: new Date() })) return;

  // Confirmar una cita es lo que abre la puerta del expediente clínico, no al revés.
  // Si ya existía un vínculo ENDED, NO se reactiva aquí — eso exige la acción explícita
  // de /relationships/:id/reactivate, para que nadie recupere acceso clínico sin querer.
  const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  await prisma.patientPsychologistRelationship.upsert({
    where: { psychologistId_patientId: { psychologistId: appt.psychologistId, patientId: appt.patientId } },
    update: {},
    create: { psychologistId: appt.psychologistId, patientId: appt.patientId, status: 'ACTIVE' },
  }).catch(() => {}); // si ya existe con otro estado, el upsert no lo toca igual — no-op seguro

  // Notificación inmediata a paciente y psicólogo (no bloquea la respuesta)
  dispatch(req.params.id, 'CONFIRMED').catch(e => console.error('[notify]', e.message));
  res.json({ id: req.params.id, status: 'CONFIRMED' });
});

appointmentsRouter.post('/:id/reject', async (req, res) => {
  if (await transition(req, res, ['REQUESTED'], 'REJECTED')) return;
  res.json({ id: req.params.id, status: 'REJECTED' });
});

appointmentsRouter.post('/:id/cancel', async (req, res) => {
  if (await transition(req, res, ['REQUESTED', 'CONFIRMED'], 'CANCELLED')) return;
  res.json({ id: req.params.id, status: 'CANCELLED' });
});

// Soporte: ¿se envió, se entregó, falló? (visible solo para el psicólogo dueño de la cita)
appointmentsRouter.get('/:id/notifications', async (req, res) => {
  const a = await prisma.appointment.findFirst({ where: { id: req.params.id, psychologistId: req.user.psychologistId }, select: { id: true } });
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  res.json(await prisma.notificationLog.findMany({ where: { appointmentId: a.id }, orderBy: { createdAt: 'asc' } }));
});

// Historial agregado (todas las citas del psicólogo) — para la pantalla de Solicitudes/Notificaciones del panel.
appointmentsRouter.get('/notifications/recent', async (req, res) => {
  const logs = await prisma.notificationLog.findMany({
    where: { appointment: { psychologistId: req.user.psychologistId } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { appointment: { select: { id: true, startsAt: true, patient: { select: { name: true } } } } },
  });
  res.json(logs);
});
