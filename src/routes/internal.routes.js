import { Router } from 'express';
import { requireCronSecret } from '../middleware/cronAuth.js';
import { runReminders } from '../services/scheduler.js';

export const internalRouter = Router();

// El cron EXTERNO (cron-job.org, Google Cloud Scheduler...) llama esto cada minuto.
// GET para que casi cualquier servicio de cron gratuito pueda llamarlo sin configurar body.
internalRouter.get('/cron/run-reminders', requireCronSecret, async (req, res) => {
  try {
    const result = await runReminders();
    res.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (e) {
    console.error('[internal/cron]', e);
    res.status(500).json({ ok: false });
  }
});
