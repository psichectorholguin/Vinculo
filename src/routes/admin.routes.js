import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/auth.js';
import { decryptField } from '../lib/crypto.js';
import { logClinicalAccess } from '../services/audit.service.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// Acceso de EMERGENCIA, explícito y pesadamente auditado. Un admin normal no tiene
// ninguna otra ruta para leer contenido clínico — esta es la única puerta, y queda
// un rastro permanente con el motivo. Úsalo solo con un proceso organizacional detrás
// (aviso a la psicóloga, revisión legal), el código por sí solo no sustituye eso.
const breakGlassSchema = z.object({ reason: z.string().min(20).max(500) });

adminRouter.post('/clinical-records/:recordId/break-glass', async (req, res) => {
  const parsed = breakGlassSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Debes indicar un motivo detallado (mínimo 20 caracteres)' });

  const record = await prisma.clinicalRecord.findUnique({
    where: { id: req.params.recordId },
    include: { relationship: true, notes: true },
  });
  if (!record) return res.status(404).json({ error: 'No encontrado' });

  await logClinicalAccess({
    actorType: 'ADMIN', actorId: req.user.adminId,
    psychologistId: record.relationship.psychologistId, patientId: record.relationship.patientId,
    recordId: record.id, action: 'ADMIN_BREAK_GLASS_ACCESS', reason: parsed.data.reason, ip: req.ip,
  });

  res.json({
    record: decryptField(record),
    notes: record.notes.map(n => ({ id: n.id, sessionDate: n.sessionDate, ...decryptField(n) })),
    warning: 'Este acceso quedó registrado de forma permanente con el motivo indicado.',
  });
});

// Historial de auditoría de un paciente — para soporte/compliance, sin tocar contenido clínico.
adminRouter.get('/patients/:patientId/audit-log', async (req, res) => {
  const logs = await prisma.clinicalAuditLog.findMany({
    where: { patientId: req.params.patientId },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json(logs);
});
