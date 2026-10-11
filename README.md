# PsicoHoy — Backend de reservas y notificaciones (V1)

Node.js + Express + PostgreSQL (Prisma). Cubre:

- **Link público de reserva** del psicólogo (`/public/:slug`) sin login para el paciente.
- **Validación** de la solicitud por el psicólogo (`REQUESTED → CONFIRMED / REJECTED`).
- **Notificaciones** por WhatsApp y email a paciente **y** psicólogo:
  al confirmar, **24 h antes** y **1 h antes**.
- **Anti doble reserva** a nivel de base de datos.

## Puesta en marcha

```bash
npm install
cp .env.example .env          # completa las variables
npx prisma migrate dev --name init
# luego ejecuta prisma/migrations/20260927_init_slot_lock/migration.sql
# (índice único parcial; Prisma no lo expresa en el schema)
npm run dev
```

Datos mínimos para probar: un `Psychologist` (con `slug`), y filas de `Availability`
(`weekday` 0=dom…6=sáb, `startMinute`/`endMinute` en minutos desde 00:00, ej. 540–720 = 09:00–12:00).

## Endpoints

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| GET | `/public/:slug` | Paciente (público) | Nombre y duración de sesión |
| GET | `/public/:slug/slots?date=YYYY-MM-DD` | Paciente | Cupos libres del día |
| POST | `/public/:slug/bookings` | Paciente | Crea la solicitud (`REQUESTED`) |
| GET | `/appointments?status=REQUESTED` | Psicólogo (JWT) | Lista sus citas |
| POST | `/appointments/:id/confirm` | Psicólogo | Confirma y dispara la notificación |
| POST | `/appointments/:id/reject` \| `/cancel` | Psicólogo | Rechaza / cancela |
| GET | `/appointments/:id/notifications` | Psicólogo | Estado de envíos (soporte) |

Ejemplo de reserva:

```json
POST /public/maria-lopez/bookings
{ "date":"2026-09-28", "time":"17:00", "type":"Individual", "modality":"Online",
  "name":"Ana Pérez", "email":"ana@mail.com", "phone":"+593999999999", "whatsappOptIn":true }
```

## Cómo funcionan las garantías importantes

**Doble reserva.** El backend recalcula el cupo (no confía en el frontend) y además
existe un índice único parcial `(psychologistId, startsAt) WHERE status IN ('REQUESTED','CONFIRMED')`.
Si dos pacientes envían a la vez, uno recibe `409` y su transacción se revierte.

**Recordatorios — pensado para hosting gratis.** Por defecto, `runReminders()` NO corre solo:
lo dispara un cron **externo y gratuito** (cron-job.org, Google Cloud Scheduler, etc.) llamando
cada minuto a `GET /internal/cron/run-reminders` con el header `x-cron-secret: <CRON_SECRET>`.
Así no necesitas un servidor que nunca duerma — con Render plan gratis basta, porque el cron
externo lo despierta cuando toca. Si el servicio estuvo dormido/caído, el pendiente se envía en
la siguiente invocación mientras la cita no haya empezado.

Si en algún momento sí tienes un proceso siempre vivo (Render Starter, Railway, una VM propia)
y prefieres no depender de un servicio externo, pon `RUN_SCHEDULER_INPROCESS=true` y el propio
proceso corre el cron cada minuto con `node-cron`.

### Configurar el cron externo (gratis)

1. Crea cuenta en [cron-job.org](https://cron-job.org) (gratis).
2. Nuevo cron job → URL: `https://tu-api.onrender.com/internal/cron/run-reminders`
3. Método: GET · Header personalizado: `x-cron-secret: <el mismo valor que CRON_SECRET en tu .env>`
4. Intervalo: cada 1 minuto.
5. Guarda y revisa el historial de ejecuciones ahí mismo — te dice si cada llamada respondió 200.

**Sin duplicados.** `NotificationLog` tiene `UNIQUE(appointmentId, recipient, channel, type)`;
se "reclama" el envío insertando la fila antes de llamar al proveedor.

**Permisos.** Toda transición filtra por `psychologistId` del token en el `WHERE`;
un psicólogo no puede tocar citas de otro aunque adivine el ID.

## Historia clínica (módulo nuevo)

**Regla de acceso, una sola puerta:** ninguna ruta de `/clinical/*` responde sin un
vínculo `PatientPsychologistRelationship` en estado `ACTIVE` entre la psicóloga del
token y el `patientId` de la URL. Esto se evalúa siempre en el servidor
(`middleware/clinicalAccess.js`), nunca se infiere del frontend.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/clinical/patients/:patientId/record` | Expediente (resumen cifrado) |
| GET | `/clinical/patients/:patientId/notes` | Notas, ya descifradas para la psicóloga dueña |
| POST | `/clinical/patients/:patientId/notes` | Crea una nota — **insert-only**, no hay editar/borrar |
| POST | `/clinical/patients/:patientId/documents` | Pide una URL firmada de subida (5 min) |
| POST | `/clinical/patients/:patientId/documents/:id/confirm` | Confirma que el archivo ya se subió |
| GET | `/clinical/patients/:patientId/documents/:id/url` | URL firmada de lectura (10 min) |
| GET/POST | `/relationships` | Lista y gestiona vínculos paciente-psicóloga |
| POST | `/relationships/:id/end` \| `/reactivate` | Termina o reactiva el acceso (reactivar es siempre explícito) |
| POST | `/admin/clinical-records/:id/break-glass` | Acceso de emergencia, exige motivo, queda auditado |

**Cifrado.** Cada nota y el resumen del expediente se cifran campo a campo con
AES-256-GCM antes de tocar la base de datos (`lib/crypto.js`). La llave vive en
`CLINICAL_ENCRYPTION_KEY` (32 bytes en base64); si el ciphertext se altera, `decryptField`
lanza un error en vez de devolver datos corruptos. Esto es cifrado a nivel de aplicación,
suficiente para V1 — cuando el volumen lo justifique, cambia `getKey()` para traer la
llave de un KMS real (AWS KMS, GCP KMS, Vault) sin tocar el resto del código.

**Documentos.** Solo se guarda la metadata en Postgres; el archivo va a un bucket
privado S3-compatible (`lib/storage.js` sirve igual con Supabase Storage, Cloudflare R2
o AWS S3 — solo cambian las variables `S3_*`). Nunca hay una URL pública fija: todo
enlace es firmado y expira en minutos.

**Notas insert-only.** No existe `PUT`/`DELETE` de contenido clínico. Una corrección se
registra como nota nueva con `correctsNoteId` apuntando a la original — el expediente
nunca pierde lo que realmente se escribió y cuándo. Es una decisión deliberada por el
peso legal de un registro clínico; revísala con tu asesor legal antes de lanzar.

**Admin ≠ acceso clínico.** `requireAdmin` autentica identidad de administrador, pero
ninguna ruta de `/clinical/*` acepta ese rol. La única puerta para un admin es
`/admin/clinical-records/:id/break-glass`, que exige un motivo de mínimo 20 caracteres
y deja un `ClinicalAuditLog` permanente. El código impone el registro; que exista además
un proceso humano detrás (avisar a la psicóloga, revisión legal) es responsabilidad tuya.

**Vínculo paciente-psicóloga.** Se crea solo al **confirmar** la primera cita entre ambos
(`appointments.routes.js`), nunca antes. Si el vínculo ya estaba `ENDED`, confirmar una
nueva cita NO lo reactiva solo — hace falta `POST /relationships/:id/reactivate` a propósito.

### Correr las pruebas de seguridad

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/psicohoy_test"   # BD desechable, nunca producción
export CLINICAL_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export JWT_SECRET="test-secret"
npx prisma migrate deploy
npm test
```

Cubren exactamente los casos que nos propusimos antes de construir esto:
psicóloga A accede a su paciente / no accede al paciente de otra, un admin no entra
directo, break-glass exige motivo y audita, vínculo `ENDED` bloquea el acceso, y las
notas no se pueden editar ni borrar por API.

## Antes de producción (pendiente / decisiones tuyas)

1. **WhatsApp**: crear y aprobar en Meta las 4 plantillas de `whatsapp.service.js`
   (variables `{{1}}…{{5}}` = nombre, contraparte, fecha, hora, modalidad). Sin plantilla
   aprobada, los mensajes iniciados por la empresa se rechazan. El paciente solo recibe
   WhatsApp si marcó el consentimiento (`whatsappOptIn`); falta el flujo de baja (STOP).
2. **Email**: configurar dominio verificado (SPF/DKIM) en Resend o tu proveedor.
3. **Login del psicólogo**: aquí solo se valida el JWT; falta el módulo de registro/login.
4. **Reintentos**: un envío `FAILED` no se reintenta solo; añade una pasada que reintente con backoff.
5. **Scheduler**: deja `RUN_SCHEDULER=true` en una sola instancia (o migra a una cola como BullMQ al escalar).
6. **Datos personales**: el email/teléfono del paciente son datos personales; revisa la normativa
   de protección de datos del país antes de lanzar. Los mensajes no incluyen información clínica.
7. **Tests recomendados**: dos reservas simultáneas al mismo cupo (una debe fallar con 409),
   psicólogo A intentando confirmar cita de psicólogo B (409), recordatorio no duplicado si el scheduler corre dos veces.
8. **KMS real** antes de manejar volumen serio de pacientes: `CLINICAL_ENCRYPTION_KEY` en una
   variable de entorno es razonable para V1, no para escala — migra a un KMS gestionado.
9. **Rotación de llaves**: el esquema ya guarda `keyVersion` por registro; falta el script que
   re-cifre lo existente cuando rotes la llave por primera vez.
10. **Alertas sobre break-glass**: hoy queda auditado, pero nadie se entera en el momento.
    Antes de lanzar, conecta ese evento a una notificación (email/Slack) al equipo legal/dirección.
