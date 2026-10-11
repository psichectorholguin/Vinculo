import { app } from './app.js';
import { startInProcessScheduler } from './services/scheduler.js';

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API escuchando en :${port}`);
  // Por defecto el scheduler lo dispara un cron EXTERNO contra /internal/cron/run-reminders
  // (sirve en plan gratis). Solo si tienes un proceso siempre vivo y prefieres no depender
  // de un servicio externo, pon RUN_SCHEDULER_INPROCESS=true.
  if (process.env.RUN_SCHEDULER_INPROCESS === 'true') startInProcessScheduler();
});
