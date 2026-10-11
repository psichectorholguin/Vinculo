// Crea datos mínimos para probar la plataforma de punta a punta:
// una psicóloga, su horario semanal, un admin, y los tokens de acceso de ambos.
//
// Uso:
//   DATABASE_URL="..." JWT_SECRET="..." node scripts/seed.js
//
// Es seguro correrlo varias veces (usa upsert); no borra datos existentes.
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma.js';

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el entorno.');
  process.exit(1);
}

const psy = await prisma.psychologist.upsert({
  where: { slug: 'maria-lopez' },
  update: {},
  create: {
    slug: 'maria-lopez',
    name: 'Dra. María López',
    email: 'maria.lopez@ejemplo.com',
    phone: '+593999999999',
    timezone: 'America/Guayaquil',
    slotMinutes: 50,
  },
});

// Lunes a viernes, 09:00–12:00 y 15:00–18:00 (minutos desde medianoche)
const windows = [
  [540, 720],  // 09:00–12:00
  [900, 1080], // 15:00–18:00
];
await prisma.availability.deleteMany({ where: { psychologistId: psy.id } });
for (let weekday = 1; weekday <= 5; weekday++) {
  for (const [startMinute, endMinute] of windows) {
    await prisma.availability.create({ data: { psychologistId: psy.id, weekday, startMinute, endMinute } });
  }
}

const admin = await prisma.admin.upsert({
  where: { email: 'admin@psicohoy.com' },
  update: {},
  create: { email: 'admin@psicohoy.com', name: 'Equipo PsicoHoy' },
});

const psychologistToken = jwt.sign({ role: 'PSYCHOLOGIST', psychologistId: psy.id }, process.env.JWT_SECRET, { expiresIn: '180d' });
const adminToken = jwt.sign({ role: 'ADMIN', adminId: admin.id }, process.env.JWT_SECRET, { expiresIn: '180d' });

console.log('\n✅ Listo. Datos creados:\n');
console.log('Psicóloga:', psy.name, '· slug:', psy.slug, '· id:', psy.id);
console.log('Link público de reserva (una vez desplegado): https://tu-api.onrender.com/public/' + psy.slug);
console.log('\nToken de la psicóloga (pégalo en el panel, dura 180 días):\n');
console.log(psychologistToken);
console.log('\nToken de admin (para probar break-glass), dura 180 días:\n');
console.log(adminToken);
console.log('');

await prisma.$disconnect();
