/**
 * Dynamic tray icon: two "remaining" bars in the spirit of CodexBar's
 * menu-bar meter. Top (thick) = short window (session), bottom (thin) =
 * long window (week). Pure Node — rasterized by hand and encoded as PNG so
 * it works the same on Windows and Linux without a canvas dependency.
 */
const zlib = require('zlib');

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  copilot: 'Copilot',
  windsurf: 'Windsurf',
  kiro: 'Kiro',
};

// Same thresholds as the cards (renderer.js severityClass), on percent used.
const COLORS = {
  ok: [52, 199, 89],
  warning: [255, 159, 10],
  critical: [255, 69, 58],
  track: [128, 128, 128],
};

function clampPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function severity(usedPercent) {
  if (usedPercent >= 70) return 'critical';
  if (usedPercent >= 45) return 'warning';
  return 'ok';
}

/**
 * Reduce a provider's usage payload to { session, week } percent used.
 * @returns {{ session: number, week: number | null } | null}
 */
function extractWindows(providerId, usage) {
  if (!usage) return null;
  switch (providerId) {
    case 'claude':
      if (!usage.session) return null;
      return {
        session: clampPercent(usage.session.percent),
        week: clampPercent(usage.week?.percent),
      };
    case 'codex':
      if (!usage.primary) return null;
      return {
        session: clampPercent(usage.primary.percent),
        week: clampPercent(usage.secondary?.percent),
      };
    case 'cursor':
      return { session: clampPercent(usage.percent), week: null };
    case 'antigravity': {
      const percents = (usage.groups || []).flatMap((g) => (
        g.buckets && g.buckets.length > 0 ? g.buckets.map((b) => b.percent) : [g.percent]
      )).map(clampPercent).filter((p) => p != null);
      if (percents.length === 0) return null;
      return { session: Math.max(...percents), week: null };
    }
    case 'copilot': {
      // Premium requests on top, chat below (both monthly), matching the card.
      const top = usage.primary ?? usage.secondary;
      if (!top) return null;
      return {
        session: clampPercent(top.percent),
        week: usage.primary ? clampPercent(usage.secondary?.percent) : null,
        weekLabel: 'chat',
      };
    }
    case 'windsurf': {
      const top = usage.primary ?? usage.secondary;
      if (!top) return null;
      return {
        session: clampPercent(top.percent),
        week: usage.primary ? clampPercent(usage.secondary?.percent) : null,
        weekLabel: usage.kind === 'credits' ? 'flow' : 'week',
      };
    }
    case 'kiro':
      if (!usage.primary) return null;
      return {
        session: clampPercent(usage.primary.percent),
        week: clampPercent(usage.secondary?.percent),
        weekLabel: usage.secondaryKind || 'bonus',
      };
    default:
      return null;
  }
}

/**
 * Pick what the tray shows: the visible provider closest to its limit.
 * @param {Record<string, object>} results provider id -> fetchWithCache payload
 * @param {string[]} hiddenProviders
 */
function summarizeForTray(results, hiddenProviders = []) {
  const hidden = new Set(hiddenProviders);
  const entries = [];
  for (const [id, result] of Object.entries(results)) {
    if (hidden.has(id) || !result || !result.ok) continue;
    const windows = extractWindows(id, result.usage);
    if (!windows || windows.session == null) continue;
    entries.push({
      id,
      label: PROVIDER_LABELS[id] || id,
      stale: !!result.stale,
      status: result.serviceStatus?.level ?? 'none',
      ...windows,
    });
  }
  if (entries.length === 0) return { primary: null, entries, incident: null };

  const worst = (e) => Math.max(e.session, e.week ?? 0);
  const primary = entries.reduce((a, b) => (worst(b) > worst(a) ? b : a));
  return { primary, entries, incident: worstIncident(entries) };
}

const INCIDENT_RANK = { minor: 1, major: 2, critical: 3 };

/** Worst outage among visible providers (maintenance does not count), or null. */
function worstIncident(entries) {
  let worst = null;
  for (const { status } of entries) {
    if ((INCIDENT_RANK[status] ?? 0) > (INCIDENT_RANK[worst] ?? 0)) worst = status;
  }
  return worst;
}

const STATUS_SUFFIX = {
  maintenance: 'maint.',
  minor: 'degraded',
  major: 'outage',
  critical: 'outage',
};

function formatTooltip(summary) {
  if (!summary.primary) return 'GenAIUsageWidget';
  const lines = summary.entries.map((e) => {
    let line = `${e.label}: ${Math.round(100 - e.session)}% left`;
    if (e.week != null) line += ` (${e.weekLabel || 'week'} ${Math.round(100 - e.week)}%)`;
    if (e.stale) line += ' *';
    if (STATUS_SUFFIX[e.status]) line += ` ⚠ ${STATUS_SUFFIX[e.status]}`;
    return line;
  });
  // Windows truncates tray tooltips at 127 characters.
  const text = lines.join('\n');
  return text.length > 127 ? `${text.slice(0, 126)}…` : text;
}

// --- Rasterizer -----------------------------------------------------------

/** Signed-distance coverage for a rounded rect, supersampled. */
function roundedRectCoverage(px, py, rect, samples) {
  const { x, y, w, h, r } = rect;
  let hit = 0;
  for (let sy = 0; sy < samples; sy += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      const fx = px + (sx + 0.5) / samples;
      const fy = py + (sy + 0.5) / samples;
      if (fx < x || fx > x + w || fy < y || fy > y + h) continue;
      const cx = Math.min(Math.max(fx, x + r), x + w - r);
      const cy = Math.min(Math.max(fy, y + r), y + h - r);
      const dx = fx - cx;
      const dy = fy - cy;
      if (dx * dx + dy * dy <= r * r) hit += 1;
    }
  }
  return hit / (samples * samples);
}

function blend(pixels, size, rect, rgb, alpha) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const x1 = Math.min(size, Math.ceil(rect.x + rect.w));
  const y0 = Math.max(0, Math.floor(rect.y));
  const y1 = Math.min(size, Math.ceil(rect.y + rect.h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const a = roundedRectCoverage(px, py, rect, 4) * alpha;
      if (a <= 0) continue;
      const i = (py * size + px) * 4;
      const dstA = pixels[i + 3] / 255;
      const outA = a + dstA * (1 - a);
      for (let c = 0; c < 3; c += 1) {
        const src = rgb[c];
        const dst = pixels[i + c];
        pixels[i + c] = Math.round((src * a + dst * dstA * (1 - a)) / outA);
      }
      pixels[i + 3] = Math.round(outA * 255);
    }
  }
}

function drawBar(pixels, size, rect, usedPercent, dim) {
  const alpha = dim ? 0.55 : 1;
  blend(pixels, size, rect, COLORS.track, 0.45 * alpha);
  if (usedPercent == null) return;
  const remaining = (100 - usedPercent) / 100;
  if (remaining <= 0) return;
  // Keep a visible sliver for tiny remainders so "almost out" is not "empty".
  const w = Math.max(rect.h, rect.w * remaining);
  blend(pixels, size, { ...rect, w }, COLORS[severity(usedPercent)], alpha);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Render the meter as a square PNG. Layout is defined on a 16px grid and
 * scaled, so 16/24/32px all share the same proportions.
 * @param {{ session: number, week: number | null, stale?: boolean, incident?: string | null }} entry
 */
function renderTrayPng(entry, size = 16) {
  const s = size / 16;
  const pixels = Buffer.alloc(size * size * 4);
  const hasWeek = entry.week != null;
  const top = hasWeek
    ? { x: 1 * s, y: 3 * s, w: 14 * s, h: 5.5 * s, r: 1.75 * s }
    : { x: 1 * s, y: 5 * s, w: 14 * s, h: 6 * s, r: 2 * s };
  drawBar(pixels, size, top, entry.session, entry.stale);
  if (hasWeek) {
    const bottom = { x: 1 * s, y: 10 * s, w: 14 * s, h: 3 * s, r: 1.5 * s };
    drawBar(pixels, size, bottom, entry.week, entry.stale);
  }
  if (entry.incident) {
    // Status-page badge in the top-right corner: amber when degraded, red when down.
    const color = entry.incident === 'minor' ? COLORS.warning : COLORS.critical;
    const d = 6 * s;
    blend(pixels, size, { x: size - d, y: 0, w: d, h: d, r: d / 2 }, [0, 0, 0], 0.55);
    const inner = 4.4 * s;
    const off = (d - inner) / 2;
    blend(pixels, size, { x: size - d + off, y: off, w: inner, h: inner, r: inner / 2 }, color, 1);
  }
  return encodePng(pixels, size);
}

module.exports = {
  PROVIDER_LABELS,
  extractWindows,
  summarizeForTray,
  formatTooltip,
  renderTrayPng,
};
