import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';
import { requireActiveRelationship } from '../middleware/clinicalAccess.js';
import { encryptField, decryptField, CURRENT_KEY_VERSION } from '../lib/crypto.js';
import { logClinicalAccess } from '../services/audit.service.js';
import { buildStorageKey, getUploadUrl, getDownloadUrl } from '../lib/storage.js';

export const clinicalRouter = Router();
clinicalRouter.use(requirePsychologist);
clinicalRouter.use('/patients/:patientId', requireActiveRelationship);

function decryptNote(n) {
  return {
    id: n.id,
    sessionDate: n.sessionDate,
    createdAt: n.createdAt,
    visibility: n.visibility,
    correctsNoteId: n.correctsNoteId,
    ...decryptField(n),
  };
}

// Crea el expediente vacío la primera vez que se accede a un vínculo (lazy init).
async function ensureRecord(relationship) {
  if (relationship.record) return relationship.record;
  const empty = encryptField({});
  return prisma.clinicalRecord.create({
    data: { relationshipId: relationship.id, ...empty },
  });
}

// GET /clinical/patients/:patientId/record
clinicalRouter.get('/patients/:patientId/record', async (req, res) => {
  const record = await ensureRecord(req.relationship);
  await logClinicalAccess({
    actorType: 'PSYCHOLOGIST', actorId: req.user.psychologistId,
    psychologistId: req.user.psychologistId, patientId: req.params.patientId,
    recordId: record.id, action: 'RECORD_VIEWED', ip: req.ip,
  });
  res.json({ id: record.id, createdAt: record.createdAt, ...decryptField(record) });
});

// GET /clinical/patients/:patientId/notes
clinicalRouter.get('/patients/:patientId/notes', async (req, res) => {
  const record = await ensureRecord(req.relationship);
  const notes = await prisma.clinicalNote.findMany({
    where: { clinicalRecordId: record.id },
    orderBy: { sessionDate: 'desc' },
  });
  await logClinicalAccess({
    actorType: 'PSYCHOLOGIST', actorId: req.user.psychologistId,
    psychologistId: req.user.psychologistId, patientId: req.params.patientId,
    recordId: record.id, action: 'RECORD_VIEWED', ip: req.ip,
  });
  res.json(notes.map(decryptNote));
});

const noteSchema = z.object({
  sessionDate: z.string().datetime(),
  motivo: z.string().min(1).max(300),
  observaciones: z.string().max(5000).default(''),
  intervencion: z.string().max(5000).default(''),
  evolucion: z.string().max(5000).default(''),
  proximosPasos: z.string().max(2000).default(''),
  visibility: z.enum(['PRIVATE', 'SHARED']).default('PRIVATE'),
  correctsNoteId: z.string().uuid().optional(),
});

// POST /clinical/patients/:patientId/notes  — INSERT-ONLY, no hay PUT/DELETE de contenido.
// Una corrección se envía como nota nueva con correctsNoteId apuntando a la original;
// la original nunca se borra ni se sobreescribe.
clinicalRouter.post('/patients/:patientId/notes', async (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
  const { sessionDate, visibility, correctsNoteId, ...clinicalContent } = parsed.data;

  const record = await ensureRecord(req.relationship);
  const encrypted = encryptField(clinicalContent);
  const note = await prisma.clinicalNote.create({
    data: {
      clinicalRecordId: record.id,
      authorId: req.user.psychologistId,
      sessionDate: new Date(sessionDate),
      visibility, correctsNoteId,
      ...encrypted,
    },
  });
  await logClinicalAccess({
    actorType: 'PSYCHOLOGIST', actorId: req.user.psychologistId,
    psychologistId: req.user.psychologistId, patientId: req.params.patientId,
    recordId: record.id, action: 'NOTE_CREATED', ip: req.ip,
  });
  res.status(201).json(decryptNote(note));
});

// GET /clinical/patients/:patientId/documents  -> listado (solo metadatos, nunca el archivo en sí)
clinicalRouter.get('/patients/:patientId/documents', async (req, res) => {
  const record = await ensureRecord(req.relationship);
  const docs = await prisma.clinicalDocument.findMany({
    where: { clinicalRecordId: record.id, status: 'STORED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });
  res.json(docs);
});

// POST /clinical/patients/:patientId/documents  -> pide una URL de subida firmada
const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024), // 20MB
});
clinicalRouter.post('/patients/:patientId/documents', async (req, res) => {
  const parsed = uploadRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Archivo inválido', details: parsed.error.flatten() });

  const record = await ensureRecord(req.relationship);
  const storageKey = buildStorageKey(record.id, parsed.data.filename);
  const doc = await prisma.clinicalDocument.create({
    data: { clinicalRecordId: record.id, uploadedById: req.user.psychologistId, storageKey, ...parsed.data },
  });
  const uploadUrl = await getUploadUrl(storageKey, parsed.data.mimeType);
  res.status(201).json({ documentId: doc.id, uploadUrl, expiresInSeconds: 300 });
});

// POST /clinical/patients/:patientId/documents/:id/confirm  -> el cliente avisa que ya subió el archivo
clinicalRouter.post('/patients/:patientId/documents/:id/confirm', async (req, res) => {
  const doc = await prisma.clinicalDocument.updateMany({
    where: { id: req.params.id, clinicalRecordId: req.relationship.record?.id },
    data: { status: 'STORED' },
  });
  if (doc.count === 0) return res.status(404).json({ error: 'No encontrado' });
  await logClinicalAccess({
    actorType: 'PSYCHOLOGIST', actorId: req.user.psychologistId,
    psychologistId: req.user.psychologistId, patientId: req.params.patientId,
    recordId: req.relationship.record?.id, action: 'DOCUMENT_UPLOADED', ip: req.ip,
  });
  res.json({ ok: true });
});

// GET /clinical/patients/:patientId/documents/:id/url  -> URL firmada de LECTURA, corta duración
clinicalRouter.get('/patients/:patientId/documents/:id/url', async (req, res) => {
  const doc = await prisma.clinicalDocument.findFirst({
    where: { id: req.params.id, clinicalRecordId: req.relationship.record?.id, status: 'STORED' },
  });
  if (!doc) return res.status(404).json({ error: 'No encontrado' });

  const url = await getDownloadUrl(doc.storageKey);
  await logClinicalAccess({
    actorType: 'PSYCHOLOGIST', actorId: req.user.psychologistId,
    psychologistId: req.user.psychologistId, patientId: req.params.patientId,
    recordId: doc.clinicalRecordId, action: 'DOCUMENT_VIEWED', ip: req.ip,
  });
  res.json({ url, expiresInSeconds: 600 });
});
