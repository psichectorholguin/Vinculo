// Helpers de zona horaria sin dependencias externas (Intl).
export function partsInZone(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { ...p, hour: Number(p.hour), minute: Number(p.minute) };
}

// Convierte "2026-09-28" + minutos-desde-medianoche en la zona -> Date UTC
export function zonedToUtc(dateStr, minuteOfDay, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minuteOfDay));
  const shown = partsInZone(guess, timeZone);
  const shownMin = shown.hour * 60 + shown.minute;
  return new Date(guess.getTime() - (shownMin - minuteOfDay) * 60000);
}

export function formatHuman(date, timeZone) {
  const fecha = new Intl.DateTimeFormat('es-EC', { timeZone, day: 'numeric', month: 'long' }).format(date);
  const hora = new Intl.DateTimeFormat('es-EC', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return { fecha, hora };
}

export function weekdayOf(dateStr, timeZone) {
  const noon = zonedToUtc(dateStr, 12 * 60, timeZone);
  const w = partsInZone(noon, timeZone).weekday;
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}
