import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';
import { requireActiveRelationship } from '../middleware/clinicalAccess.js';
import { encryptField, decryptField } from '../lib/crypto.js';
import { logClinicalAccess } from '../services/audit.service.js';

export const testsRouter = Router();
testsRouter.use(requirePsychologist);

// GET /clinical/tests-catalog?q=beck  — catálogo global + el propio de esta psicóloga
testsRouter.get('/tests-catalog', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const items = await prisma.psychTestCatalog.findMany({
    where: {
      OR: [{ psychologistId: null }, { psychologistId: req.user.psychologistId }],
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: { name: 'asc' },
    take: 50,
  });
  res.json(items);
});

const catalogSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.string().max(100).optional(),
});

// POST /clinical/tests-catalog  — agrega un reactivo a mano, queda guardado para la próxima vez
testsRouter.post('/tests-catalog', async (req, res) => {
  const parsed = catalogSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos' });

  const item = await prisma.psychTestCatalog.upsert({
    where: { psychologistId_name: { psychologistId: req.user.psychologistId, name: parsed.data.name } },
    update: {},
    create: { psychologistId: req.user.psychologistId, name: parsed.data.name, category: parsed.data.category },
  });
  res.status(201).json(item);
});

// A partir de aquí, todo requiere vínculo ACTIVE con :patientId
testsRouter.use('/patients/:patientId', requireActiveRelationship);

function decryptAdministration(a) {
  return {
    id: a.id,
    testName: a.testName,
    administeredAt: a.administeredAt,
    createdAt: a.createdAt,
    ...decryptField(a),
  };
}

async function ensureRecord(relationship) {
  if (relationship.record) return relationship.record;
  const empty = encryptField({});
  return prisma.clinicalRecord.create({ data: { relationshipId: relationship.id, ...empty } });
}

// GET /clinical/patients/:patientId/tests
testsRouter.get('/patients/:patientId/tests', async (req, res) => {
  const record = await ensureRecord(req.relationship);
  const items = await prisma.testAdministration.findMany({
    where: { clinicalRecordId: record.id },
    orderBy: { administeredAt: 'desc' },
  });
  res.json(items.map(decryptAdministration));
});

const administerSchema = z.object({
  testName: z.string().min(1).max(150),
  testCatalogId: z.string().uuid().optional(),
  administeredAt: z.string().datetime(),
  notas: z.string().max(5000).default(''),
});

// POST /clinical/patients/:patientId/tests — registra que se aplicó un reactivo
testsRouter.post('/patients/:patientId/tests', async (req, res) => {
  const parsed = administerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });

  const record = await ensureRecord(req.relationship);
  const encrypted = encryptField({ notas: parsed.data.notas });
  const item = await prisma.testAdministration.create({
    data: {
      clinicalRecordId: record.id,
      testName: parsed.data.testName,
      testCatalogId: parsed.data.testCatalogId,
      administeredAt: new Date(parsed.data.administeredAt),
      ...encrypted,
    },
  });
  await logClinicalAccess({
    actorType: 'PSYCHOLOGIST', actorId: req.user.psychologistId,
    psychologistId: req.user.psychologistId, patientId: req.params.patientId,
    recordId: record.id, action: 'NOTE_CREATED', ip: req.ip,
  }).catch(() => {});
  res.status(201).json(decryptAdministration(item));
});
