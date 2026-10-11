import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';
import { logClinicalAccess } from '../services/audit.service.js';

export const relationshipsRouter = Router();
relationshipsRouter.use(requirePsychologist);

// GET /relationships  -> pacientes vinculados a la psicóloga autenticada (para el CRM)
relationshipsRouter.get('/', async (req, res) => {
  const items = await prisma.patientPsychologistRelationship.findMany({
    where: { psychologistId: req.user.psychologistId },
    include: { patient: { select: { id: true, name: true, email: true } } },
    orderBy: { startedAt: 'desc' },
  });
  res.json(items);
});

// POST /relationships/:id/end  -> termina el vínculo; desde ese momento el acceso al
// expediente queda bloqueado (ver middleware/clinicalAccess.js), incluso para esta misma psicóloga.
const endSchema = z.object({ reason: z.string().max(300).optional() });
relationshipsRouter.post('/:id/end', async (req, res) => {
  endSchema.parse(req.body ?? {});
  const { count } = await prisma.patientPsychologistRelationship.updateMany({
    where: { id: req.params.id, psychologistId: req.user.psychologistId, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: new Date() },
  });
  if (count === 0) return res.status(409).json({ error: 'El vínculo no existe o ya no está activo' });

  const rel = await prisma.patientPsychologistRelationship.findUnique({ where: { id: req.params.id } });
  await logClinicalAccess({
    actorType: 'PSYCHOLOGIST', actorId: req.user.psychologistId,
    psychologistId: req.user.psychologistId, patientId: rel.patientId,
    action: 'RELATIONSHIP_ENDED', ip: req.ip,
  });
  res.json({ id: req.params.id, status: 'ENDED' });
});

// POST /relationships/:id/reactivate  -> acción EXPLÍCITA, nunca automática,
// para volver a dar acceso tras un ENDED (ej. el paciente regresa meses después).
relationshipsRouter.post('/:id/reactivate', async (req, res) => {
  const { count } = await prisma.patientPsychologistRelationship.updateMany({
    where: { id: req.params.id, psychologistId: req.user.psychologistId, status: 'ENDED' },
    data: { status: 'ACTIVE', endedAt: null },
  });
  if (count === 0) return res.status(409).json({ error: 'El vínculo no existe o no está en estado ENDED' });
  res.json({ id: req.params.id, status: 'ACTIVE' });
});
