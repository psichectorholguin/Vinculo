import { prisma } from '../lib/prisma.js';
import { logClinicalAccess } from '../services/audit.service.js';

/**
 * Única puerta de entrada a un expediente clínico.
 *   ¿Autenticado? -> ¿Es psicóloga? -> ¿vínculo ACTIVE con :patientId? -> SÍ: continúa / NO: 403
 * Nunca confía en que el frontend ya filtró — esto se evalúa siempre en el servidor,
 * aunque alguien adivine o manipule el patientId en la URL.
 */
export async function requireActiveRelationship(req, res, next) {
  const psychologistId = req.user?.psychologistId;
  const patientId = req.params.patientId;

  const relationship = await prisma.patientPsychologistRelationship.findUnique({
    where: { psychologistId_patientId: { psychologistId, patientId } },
    include: { record: true },
  });

  if (!relationship || relationship.status !== 'ACTIVE') {
    await logClinicalAccess({
      actorType: 'PSYCHOLOGIST', actorId: psychologistId,
      psychologistId, patientId, recordId: relationship?.record?.id ?? null,
      action: 'ACCESS_DENIED', ip: req.ip,
    }).catch(() => {}); // el audit log nunca debe tumbar la respuesta 403
    return res.status(403).json({ error: 'No tienes un vínculo activo con este paciente' });
  }

  req.relationship = relationship;
  next();
}
