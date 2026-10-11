import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';

export const meRouter = Router();
meRouter.use(requirePsychologist);

const PROFILE_FIELDS = {
  id: true, slug: true, name: true, email: true, phone: true,
  timezone: true, slotMinutes: true, notifyWhatsapp: true, notifyEmail: true,
  reminder24h: true, reminder1h: true, createdAt: true,
};

// GET /me — perfil básico de la psicóloga autenticada (para armar su link público en el panel)
meRouter.get('/', async (req, res) => {
  const psy = await prisma.psychologist.findUnique({
    where: { id: req.user.psychologistId },
    select: PROFILE_FIELDS,
  });
  if (!psy) return res.status(404).json({ error: 'No encontrado' });
  res.json(psy);
});

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  phone: z.string().max(30).optional(),
  timezone: z.string().max(60).optional(),
  slotMinutes: z.number().int().min(15).max(240).optional(),
  notifyWhatsapp: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  reminder24h: z.boolean().optional(),
  reminder1h: z.boolean().optional(),
});

// PATCH /me — editar perfil desde "Configuración" en el panel
meRouter.patch('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });

  const psy = await prisma.psychologist.update({
    where: { id: req.user.psychologistId },
    data: parsed.data,
    select: PROFILE_FIELDS,
  });
  res.json(psy);
});

// GET /me/usage — resumen para "Configuración" / "Suscripción": uso general de la cuenta
meRouter.get('/usage', async (req, res) => {
  const psychologistId = req.user.psychologistId;
  const [activePatients, totalAppointments, monthAppointments, completedTasks, pendingTasks] = await Promise.all([
    prisma.patientPsychologistRelationship.count({ where: { psychologistId, status: 'ACTIVE' } }),
    prisma.appointment.count({ where: { psychologistId } }),
    prisma.appointment.count({
      where: { psychologistId, startsAt: { gte: new Date(new Date().setDate(1)) } },
    }),
    prisma.task.count({ where: { relationship: { psychologistId }, status: 'COMPLETED' } }),
    prisma.task.count({ where: { relationship: { psychologistId }, status: 'PENDING' } }),
  ]);
  res.json({ activePatients, totalAppointments, monthAppointments, completedTasks, pendingTasks });
});
