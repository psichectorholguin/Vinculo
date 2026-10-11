import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';
import { requireActiveRelationship } from '../middleware/clinicalAccess.js';

// Montado en /clinical, bajo /patients/:patientId/tasks — misma puerta de acceso
// que el resto de lo clínico: requiere vínculo ACTIVE con ese paciente.
export const tasksRouter = Router();
tasksRouter.use(requirePsychologist);
tasksRouter.use('/patients/:patientId', requireActiveRelationship);

// GET /clinical/patients/:patientId/tasks
tasksRouter.get('/patients/:patientId/tasks', async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { relationshipId: req.relationship.id },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
  });
  res.json(tasks);
});

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(),
});

// POST /clinical/patients/:patientId/tasks
tasksRouter.post('/patients/:patientId/tasks', async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });

  const task = await prisma.task.create({
    data: {
      relationshipId: req.relationship.id,
      title: parsed.data.title,
      description: parsed.data.description,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    },
  });
  res.status(201).json(task);
});

// PATCH /clinical/patients/:patientId/tasks/:id  — solo cambia status (COMPLETED/CANCELLED/PENDING)
const statusSchema = z.object({ status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']) });
tasksRouter.patch('/patients/:patientId/tasks/:id', async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Estado inválido' });

  const { count } = await prisma.task.updateMany({
    where: { id: req.params.id, relationshipId: req.relationship.id },
    data: {
      status: parsed.data.status,
      completedAt: parsed.data.status === 'COMPLETED' ? new Date() : null,
    },
  });
  if (count === 0) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true });
});
