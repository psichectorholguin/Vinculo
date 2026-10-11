import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { zonedToUtc, weekdayOf } from '../lib/time.js';

export const publicRouter = Router();

const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

const pad = n => String(n).padStart(2, '0');
const toHHMM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMinutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Genera los cupos de un día según la disponibilidad semanal (todo calculado en el servidor)
async function slotsFor(psychologist, dateStr) {
  const wd = weekdayOf(dateStr, psychologist.timezone);
  const windows = await prisma.availability.findMany({ where: { psychologistId: psychologist.id, weekday: wd } });

  const dayStart = zonedToUtc(dateStr, 0, psychologist.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const busy = await prisma.appointment.findMany({
    where: { psychologistId: psychologist.id, status: { in: ['REQUESTED', 'CONFIRMED'] }, startsAt: { gte: dayStart, lt: dayEnd } },
    select: { startsAt: true },
  });
  const busySet = new Set(busy.map(b => b.startsAt.getTime()));

  const now = Date.now();
  const out = [];
  for (const w of windows) {
    for (let m = w.startMinute; m + psychologist.slotMinutes <= w.endMinute; m += psychologist.slotMinutes) {
      const startsAt = zonedToUtc(dateStr, m, psychologist.timezone);
      if (startsAt.getTime() > now && !busySet.has(startsAt.getTime())) out.push(toHHMM(m));
    }
  }
  return out.sort();
}

async function getPsychologist(slug) {
  return prisma.psychologist.findUnique({ where: { slug } });
}

// GET /public/:slug  -> datos públicos mínimos para la página de reserva
publicRouter.get('/:slug', async (req, res) => {
  const p = await getPsychologist(req.params.slug);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json({ name: p.name, slotMinutes: p.slotMinutes, timezone: p.timezone });
});

// GET /public/:slug/slots?date=2026-09-28
publicRouter.get('/:slug/slots', async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(req.query.date);
  if (!date.success) return res.status(400).json({ error: 'Fecha inválida' });
  const p = await getPsychologist(req.params.slug);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json({ date: date.data, slots: await slotsFor(p, date.data) });
});

const bookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  type: z.enum(['Individual', 'Pareja', 'Infantil']),
  modality: z.enum(['Online', 'Presencial']),
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(160),
  phone: z.string().regex(/^\+\d{8,15}$/, 'Usa formato internacional, ej. +593999999999').optional(),
  whatsappOptIn: z.boolean().default(false),
});

// POST /public/:slug/bookings  -> crea una solicitud (REQUESTED) que el psicólogo debe validar
publicRouter.post('/:slug/bookings', bookingLimiter, async (req, res) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
  const b = parsed.data;
  if (b.whatsappOptIn && !b.phone) return res.status(400).json({ error: 'Falta el número de WhatsApp' });

  const p = await getPsychologist(req.params.slug);
  if (!p) return res.status(404).json({ error: 'No encontrado' });

  // Revalidar en el servidor que el cupo existe y está libre (el frontend no es fuente de verdad)
  const available = await slotsFor(p, b.date);
  if (!available.includes(b.time)) return res.status(409).json({ error: 'Ese horario ya no está disponible' });

  const startsAt = zonedToUtc(b.date, toMinutes(b.time), p.timezone);
  const endsAt = new Date(startsAt.getTime() + p.slotMinutes * 60000);

  try {
    const appointment = await prisma.$transaction(async tx => {
      let patient = await tx.patient.findFirst({ where: { email: b.email } });
      const data = { name: b.name, phone: b.phone ?? null, whatsappOptIn: b.whatsappOptIn };
      patient = patient
        ? await tx.patient.update({ where: { id: patient.id }, data })
        : await tx.patient.create({ data: { ...data, email: b.email } });

      // Si otro paciente tomó el cupo entre la validación y este insert,
      // el índice único parcial lanza P2002 y la transacción se revierte.
      return tx.appointment.create({
        data: { psychologistId: p.id, patientId: patient.id, startsAt, endsAt, type: b.type, modality: b.modality },
      });
    });
    res.status(201).json({ id: appointment.id, status: appointment.status });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Ese horario ya no está disponible' });
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});
