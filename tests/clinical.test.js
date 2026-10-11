// Pruebas de los requisitos de seguridad del expediente clínico.
//
// Requieren una base de datos Postgres DESECHABLE (nunca la de producción):
//   export DATABASE_URL="postgresql://user:pass@localhost:5432/psicohoy_test"
//   export CLINICAL_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
//   export JWT_SECRET="test-secret"
//   npx prisma migrate deploy
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

function tokenFor(psychologistId) {
  return jwt.sign({ role: 'PSYCHOLOGIST', psychologistId }, process.env.JWT_SECRET);
}
function adminToken(adminId) {
  return jwt.sign({ role: 'ADMIN', adminId }, process.env.JWT_SECRET);
}

let psyA, psyB, patientA, patientB, admin;

test.before(async () => {
  psyA = await prisma.psychologist.create({ data: { slug: 'psi-a-test', name: 'Psic. A', email: 'a@test.psicohoy', slotMinutes: 50 } });
  psyB = await prisma.psychologist.create({ data: { slug: 'psi-b-test', name: 'Psic. B', email: 'b@test.psicohoy', slotMinutes: 50 } });
  patientA = await prisma.patient.create({ data: { name: 'Paciente A', email: 'pa@test.psicohoy' } });
  patientB = await prisma.patient.create({ data: { name: 'Paciente B', email: 'pb@test.psicohoy' } });
  admin = await prisma.admin.create({ data: { email: 'admin@test.psicohoy', name: 'Admin Test' } });
  await prisma.patientPsychologistRelationship.create({
    data: { psychologistId: psyA.id, patientId: patientA.id, status: 'ACTIVE' },
  });
});

test.after(async () => {
  // Limpieza en orden por las foreign keys
  await prisma.clinicalAuditLog.deleteMany({});
  await prisma.clinicalNote.deleteMany({});
  await prisma.clinicalDocument.deleteMany({});
  await prisma.clinicalRecord.deleteMany({});
  await prisma.patientPsychologistRelationship.deleteMany({});
  await prisma.patient.deleteMany({ where: { id: { in: [patientA.id, patientB.id] } } });
  await prisma.psychologist.deleteMany({ where: { id: { in: [psyA.id, psyB.id] } } });
  await prisma.admin.delete({ where: { id: admin.id } });
  await prisma.$disconnect();
});

test('Psicóloga A puede acceder al expediente de su paciente A', async () => {
  const res = await request(app)
    .get(`/clinical/patients/${patientA.id}/record`)
    .set('Authorization', `Bearer ${tokenFor(psyA.id)}`);
  assert.equal(res.status, 200);
});

test('Psicóloga A NO puede acceder al expediente del paciente B (sin vínculo)', async () => {
  const res = await request(app)
    .get(`/clinical/patients/${patientB.id}/record`)
    .set('Authorization', `Bearer ${tokenFor(psyA.id)}`);
  assert.equal(res.status, 403);
});

test('Psicóloga B NO puede acceder al paciente A aunque adivine/manipule el ID en la URL', async () => {
  const res = await request(app)
    .get(`/clinical/patients/${patientA.id}/record`)
    .set('Authorization', `Bearer ${tokenFor(psyB.id)}`);
  assert.equal(res.status, 403);
});

test('Un admin normal NO puede leer rutas clínicas directamente (requieren rol PSYCHOLOGIST)', async () => {
  const res = await request(app)
    .get(`/clinical/patients/${patientA.id}/record`)
    .set('Authorization', `Bearer ${adminToken(admin.id)}`);
  assert.equal(res.status, 401);
});

test('Admin SÍ puede entrar por break-glass, pero solo con motivo y queda auditado', async () => {
  const record = await request(app)
    .get(`/clinical/patients/${patientA.id}/record`)
    .set('Authorization', `Bearer ${tokenFor(psyA.id)}`);
  const recordId = record.body.id;

  const sinMotivo = await request(app)
    .post(`/admin/clinical-records/${recordId}/break-glass`)
    .set('Authorization', `Bearer ${adminToken(admin.id)}`)
    .send({});
  assert.equal(sinMotivo.status, 400);

  const conMotivo = await request(app)
    .post(`/admin/clinical-records/${recordId}/break-glass`)
    .set('Authorization', `Bearer ${adminToken(admin.id)}`)
    .send({ reason: 'Solicitud legal formal del paciente vía soporte, caso #1234' });
  assert.equal(conMotivo.status, 200);

  const log = await prisma.clinicalAuditLog.findFirst({
    where: { recordId, action: 'ADMIN_BREAK_GLASS_ACCESS' },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(log, 'debe quedar un registro de auditoría del break-glass');
  assert.match(log.reason, /caso #1234/);
});

test('Psicóloga desvinculada (ENDED) pierde el acceso al expediente', async () => {
  const rel = await prisma.patientPsychologistRelationship.create({
    data: { psychologistId: psyB.id, patientId: patientB.id, status: 'ACTIVE' },
  });

  const antes = await request(app)
    .get(`/clinical/patients/${patientB.id}/record`)
    .set('Authorization', `Bearer ${tokenFor(psyB.id)}`);
  assert.equal(antes.status, 200);

  await prisma.patientPsychologistRelationship.update({
    where: { id: rel.id }, data: { status: 'ENDED', endedAt: new Date() },
  });

  const despues = await request(app)
    .get(`/clinical/patients/${patientB.id}/record`)
    .set('Authorization', `Bearer ${tokenFor(psyB.id)}`);
  assert.equal(despues.status, 403);
});

test('Las notas son insert-only: no existe ruta para editar o borrar una nota ya creada', async () => {
  const creada = await request(app)
    .post(`/clinical/patients/${patientA.id}/notes`)
    .set('Authorization', `Bearer ${tokenFor(psyA.id)}`)
    .send({ sessionDate: new Date().toISOString(), motivo: 'Primera sesión' });
  assert.equal(creada.status, 201);

  const intentoEditar = await request(app)
    .put(`/clinical/patients/${patientA.id}/notes/${creada.body.id}`)
    .set('Authorization', `Bearer ${tokenFor(psyA.id)}`)
    .send({ motivo: 'Intentando reescribir el pasado' });
  assert.equal(intentoEditar.status, 404); // la ruta no existe

  const intentoBorrar = await request(app)
    .delete(`/clinical/patients/${patientA.id}/notes/${creada.body.id}`)
    .set('Authorization', `Bearer ${tokenFor(psyA.id)}`);
  assert.equal(intentoBorrar.status, 404); // tampoco existe
});
