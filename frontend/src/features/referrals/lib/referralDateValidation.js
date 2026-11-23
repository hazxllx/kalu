const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const REFERRAL_TIME_ZONE = "Asia/Manila";

const partsInManila = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REFERRAL_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

export const localDateKey = (date = new Date()) => {
  const p = partsInManila(date);
  return `${p.year}-${p.month}-${p.day}`;
};

const parseLocalDateTime = (value) => {
  const match = LOCAL_DATE_TIME_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  // Interpret datetime-local as Asia/Manila regardless of the browser's zone.
  const date = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  const local = partsInManila(date);
  if (
    Number(local.year) !== year || Number(local.month) !== month ||
    Number(local.day) !== day || Number(local.hour) !== hour || Number(local.minute) !== minute
  ) return null;
  return date;
};

export const toLocalDateTimeInput = (value) => {
  if (!value) return "";
  const raw = String(value);
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) return raw.slice(0, 16);

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const p = partsInManila(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

export const localDateTimeToIso = (value) => {
  const date = parseLocalDateTime(value);
  if (!date) return null;
  const p = partsInManila(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00+08:00`;
};

export const referralDateTimeMinimum = (now = new Date()) => {
  const nextMinute = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
  const p = partsInManila(nextMinute);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

export const referralDateErrors = (
  { referralDate, scheduledAt },
  { now = new Date(), originalScheduledAt = null } = {},
) => {
  const errors = {};
  const today = localDateKey(now);

  if (referralDate) {
    const date = new Date(`${referralDate}T00:00:00.000Z`);
    const isValidDate = DATE_ONLY_PATTERN.test(referralDate)
      && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === referralDate;
    if (isValidDate && referralDate < today) {
      errors.referralDate = "Referral date cannot be earlier than today.";
    } else if (!isValidDate) {
      errors.referralDate = "Enter a valid referral date.";
    }
  }

  if (scheduledAt && scheduledAt !== originalScheduledAt) {
    const scheduledDate = parseLocalDateTime(scheduledAt);
    if (!scheduledDate) {
      errors.scheduledAt = "Enter a valid scheduled date and time.";
    } else if (scheduledDate.getTime() <= now.getTime()) {
      errors.scheduledAt = "Scheduled date and time cannot be in the past.";
    } else if (referralDate && scheduledAt.slice(0, 10) < referralDate) {
      errors.scheduledAt = "Scheduled date cannot be earlier than the referral date.";
    }
  }

  return errors;
};
