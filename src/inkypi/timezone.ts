export function formatInTimeZone(date: Date, timezone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: timezone, ...options }).format(date);
}

export function dateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function hourInTimeZone(date: Date, timezone: string): number {
  return Number(formatInTimeZone(date, timezone, { hour: '2-digit', hour12: false }));
}

export function timeLabel(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function spanishDayAbbr(dateKeyValue: string): string {
  const date = new Date(`${dateKeyValue}T12:00:00Z`);
  const names = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
  return names[(date.getUTCDay() + 6) % 7];
}

export function spanishLongDate(date: Date, timezone: string): string {
  const weekday = formatInTimeZone(date, timezone, { weekday: 'long' });
  const day = formatInTimeZone(date, timezone, { day: '2-digit' });
  const month = formatInTimeZone(date, timezone, { month: 'long' });
  return `${capitalize(weekday)} ${day} de ${capitalize(month)}`;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
