/**
 * Draws a key as a 144x144 SVG: the key fills from the bottom by the percent
 * used ("water level"), with the limit's label on top and the number in the
 * middle. Pressing the key swaps the number for the time until reset.
 */

// Same colors and thresholds as the tray icon and cards (src/tray-icon.js).
export const COLORS = {
  ok: '#34C759',
  warning: '#FF9F0A',
  critical: '#FF453A',
};

const BG = '#0a0a0a';
const TEXT = '#f5f5f5';
const MUTED = '#a3a3a3';
const FONT = "font-family=\"'Segoe UI', sans-serif\"";

const STRINGS = {
  en: { toReset: 'to reset', signin: 'Sign in', reauth: 'Sign in again', needsWidget: 'Needs widget', none: 'No sign-ins' },
  ja: { toReset: 'でリセット', signin: '未ログイン', reauth: '再ログイン', needsWidget: 'ウィジェット要', none: 'サインインなし' },
};

function severity(percent) {
  if (percent >= 70) return 'critical';
  if (percent >= 45) return 'warning';
  return 'ok';
}

function escape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "42m", "2h14m", "3d 4h"; null when unknown or already past. */
export function formatReset(resetsAt, now = Date.now()) {
  const ms = Date.parse(resetsAt ?? '') - now;
  if (!(ms > 0)) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function titleText(title) {
  // Segoe UI semibold averages ~0.56em per character; keep a 12px side margin.
  const size = Math.max(9, Math.min(16, Math.floor((120 / (title.length * 0.56)) * 10) / 10));
  return `<text id="title" x="72" y="30" text-anchor="middle" ${FONT} font-weight="600" font-size="${size}" fill="${MUTED}">${escape(title)}</text>`;
}

function centerText(value, size, color = TEXT) {
  return `<text x="72" y="92" text-anchor="middle" ${FONT} font-weight="800" font-size="${size}" fill="${color}">${value}</text>`;
}

/**
 * @param {object} key
 * @param {string} key.title
 * @param {'ok'|'signin'|'reauth'|'needsWidget'|'none'|'error'|'loading'} key.status
 * @param {number} [key.percent]
 * @param {string|null} [key.resetsAt]
 * @param {'percent'|'reset'} [key.view]
 * @param {boolean} [key.stale]
 * @param {number} [key.now]
 * @param {string} [key.lang] Stream Deck UI language; anything but "ja" uses English
 */
export function renderKey({ title, status, percent, resetsAt, view = 'percent', stale = false, now = Date.now(), lang = 'en' }) {
  const t = STRINGS[lang] ?? STRINGS.en;
  const parts = [`<rect width="144" height="144" fill="${BG}"/>`];

  if (status === 'ok') {
    const color = COLORS[severity(percent)];
    const height = Math.round((144 * percent) / 100);
    const level = [
      `<rect id="fill" x="0" y="${144 - height}" width="144" height="${height}" fill="${color}" fill-opacity="${view === 'reset' ? 0.1 : 0.22}"/>`,
      `<rect id="level" x="0" y="${Math.max(0, 144 - height - 1.5)}" width="144" height="3" fill="${color}"${view === 'reset' ? ' opacity="0.35"' : ''}/>`,
    ];
    let body;
    if (view === 'reset') {
      const remaining = formatReset(resetsAt, now) ?? '—';
      body = centerText(escape(remaining), remaining.length > 5 ? 32 : 38)
        + `<text x="72" y="118" text-anchor="middle" ${FONT} font-size="14" fill="${MUTED}">${escape(t.toReset)}</text>`;
    } else {
      body = centerText(`${Math.round(percent)}<tspan font-size="20">%</tspan>`, 44);
    }
    parts.push(stale ? `<g opacity="0.5">${level.join('')}${body}</g>` : level.join('') + body);
    if (stale) {
      parts.push(`<g id="stale" fill="none" stroke="${MUTED}" stroke-width="2"><circle cx="126" cy="126" r="7"/><path d="M126 122v4l3 2" stroke-linecap="round"/></g>`);
    }
  } else if (status === 'error' || status === 'loading') {
    parts.push(centerText(status === 'error' ? '—' : '…', 40, MUTED));
  } else {
    parts.push(`<text x="72" y="86" text-anchor="middle" ${FONT} font-weight="700" font-size="17" fill="${MUTED}">${escape(t[status])}</text>`);
  }

  parts.push(titleText(title));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join('')}</svg>`;
}
