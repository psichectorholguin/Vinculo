import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';

// Gestión del horario semanal recurrente que usa el link público de reserva.
export const availabilityRouter = Router();
availabilityRouter.use(requirePsychologist);

// GET /availability
availabilityRouter.get('/', async (req, res) => {
  const items = await prisma.availability.findMany({
    where: { psychologistId: req.user.psychologistId },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
  });
  res.json(items);
});

const slotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).refine(d => d.endMinute > d.startMinute, { message: 'endMinute debe ser mayor que startMinute' });

// POST /availability — agrega un bloque de horario
availabilityRouter.post('/', async (req, res) => {
  const parsed = slotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Horario inválido', details: parsed.error.flatten() });

  const item = await prisma.availability.create({
    data: { psychologistId: req.user.psychologistId, ...parsed.data },
  });
  res.status(201).json(item);
});

// DELETE /availability/:id
availabilityRouter.delete('/:id', async (req, res) => {
  const { count } = await prisma.availability.deleteMany({
    where: { id: req.params.id, psychologistId: req.user.psychologistId },
  });
  if (count === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});
