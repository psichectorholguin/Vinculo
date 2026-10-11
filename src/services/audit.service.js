import { prisma } from '../lib/prisma.js';

/**
 * Registra un evento de auditoría clínica. NUNCA recibe ni guarda contenido clínico,
 * solo metadatos de quién hizo qué y cuándo. Si este insert falla, la petición que lo
 * originó debe fallar también (ver clinicalAccess.js) — preferimos negar acceso a
 * dejar una acción clínica sin rastro.
 */
export async function logClinicalAccess({ actorType, actorId, psychologistId, patientId, recordId, action, reason, ip }) {
  await prisma.clinicalAuditLog.create({
    data: { actorType, actorId, psychologistId, patientId, recordId, action, reason, ip },
  });
}
