// Protege la ruta que dispara el scheduler: solo responde si viene con el secreto
// compartido con el servicio de cron externo (cron-job.org, Google Cloud Scheduler, etc).
export function requireCronSecret(req, res, next) {
  const given = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || given !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}
