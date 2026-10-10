const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

function pad(value) {
  return String(value).padStart(2, '0');
}

function getShanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
}

function nowShanghaiString() {
  const p = getShanghaiParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function todayShanghai() {
  const p = getShanghaiParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function dateDaysAgoShanghai(days) {
  const [y, m, d] = todayShanghai().split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() - days);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

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

function dateFilename() {
  return todayShanghai();
}

module.exports = {
  SHANGHAI_TIME_ZONE,
  nowShanghaiString,
  todayShanghai,
  dateDaysAgoShanghai,
  parseDate,
  formatShanghai,
  dateFilename,
};
