-- This is an empty migration.
CREATE UNIQUE INDEX "appointment_active_slot_unique" ON "Appointment" ("psychologistId", "startsAt") WHERE "status" IN ('REQUESTED', 'CONFIRMED');