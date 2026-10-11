import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requirePsychologist } from '../middleware/auth.js';

export const meRouter = Router();
meRouter.use(requirePsychologist);

// GET /me — perfil básico de la psicóloga autenticada (para armar su link público en el panel)
meRouter.get('/', async (req, res) => {
  const psy = await prisma.psychologist.findUnique({
    where: { id: req.user.psychologistId },
    select: { id: true, slug: true, name: true, slotMinutes: true, timezone: true },
  });
  if (!psy) return res.status(404).json({ error: 'No encontrado' });
  res.json(psy);
});
