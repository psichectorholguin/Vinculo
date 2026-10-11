import express from 'express';
import cors from 'cors';
import { publicRouter } from './routes/public.routes.js';
import { appointmentsRouter } from './routes/appointments.routes.js';
import { internalRouter } from './routes/internal.routes.js';
import { clinicalRouter } from './routes/clinical.routes.js';
import { relationshipsRouter } from './routes/relationships.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { meRouter } from './routes/me.routes.js';

// Construcción de la app separada de index.js (que hace el listen()) para poder
// importar `app` directo en los tests sin levantar un puerto real.
export const app = express();
app.use(cors({ origin: process.env.APP_BASE_URL }));
app.use(express.json({ limit: '50kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/public', publicRouter);              // link de reserva del paciente (sin login)
app.use('/appointments', appointmentsRouter);  // panel del psicólogo (JWT)
app.use('/relationships', relationshipsRouter);// vínculo paciente-psicóloga (JWT)
app.use('/clinical', clinicalRouter);          // expediente, notas, documentos (JWT + vínculo ACTIVE)
app.use('/admin', adminRouter);                // backoffice — break-glass auditado (JWT admin)
app.use('/me', meRouter);                      // perfil básico de la psicóloga autenticada
app.use('/internal', internalRouter);          // disparado por el cron externo (secreto compartido)
