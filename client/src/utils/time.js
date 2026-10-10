const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const date = new Date(hasZone ? normalized : `${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShanghai(value, options = {}) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    ...options,
  }).format(date).replaceAll('/', '-');
}

function formatDateShanghai(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replaceAll('/', '-');
}

function todayShanghai() {
  return formatDateShanghai(new Date());
}

export { parseDate, formatShanghai, formatDateShanghai, todayShanghai };
