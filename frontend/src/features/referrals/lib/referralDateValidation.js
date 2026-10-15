const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const localDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseLocalDateTime = (value) => {
  const match = LOCAL_DATE_TIME_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) return null;
  return date;
};

export const toLocalDateTimeInput = (value) => {
  if (!value) return "";
  const raw = String(value);
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) return raw.slice(0, 16);

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = localDateKey(date);
  const timePart = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${datePart}T${timePart}`;
};

export const localDateTimeToIso = (value) => parseLocalDateTime(value)?.toISOString() || null;

export const referralDateTimeMinimum = (now = new Date()) => {
  const nextMinute = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
  const timePart = `${String(nextMinute.getHours()).padStart(2, "0")}:${String(nextMinute.getMinutes()).padStart(2, "0")}`;
  return `${localDateKey(nextMinute)}T${timePart}`;
};

export const referralDateErrors = (
  { referralDate, scheduledAt },
  { now = new Date(), originalScheduledAt = null } = {},
) => {
  const errors = {};
  const today = localDateKey(now);

  if (referralDate) {
    const date = new Date(`${referralDate}T00:00:00`);
    const isValidDate = DATE_ONLY_PATTERN.test(referralDate)
      && !Number.isNaN(date.getTime())
      && localDateKey(date) === referralDate;
    if (isValidDate && referralDate > today) {
      errors.referralDate = "Referral date cannot be later than today.";
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
    }
  }

  return errors;
};
