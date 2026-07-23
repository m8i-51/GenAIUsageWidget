const EDGE_SNAP_THRESHOLD = 28;
const PEEK_SIZE = 28;
const DEFAULT_FULL_WIDTH = 300;
const VALID_EDGES = new Set(['left', 'right']);

function normalizeEdge(edge) {
  return VALID_EDGES.has(edge) ? edge : null;
}

/**
 * Distance from window bounds to each horizontal work-area edge.
 * Uses the visible right edge (x+width) so collapsed peek strips still measure correctly.
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 */
function edgeDistances(bounds, workArea) {
  return {
    left: bounds.x - workArea.x,
    right: (workArea.x + workArea.width) - (bounds.x + bounds.width),
  };
}

/**
 * Nearest horizontal edge within snap threshold, or null.
 * Prefers the closer edge when both qualify.
 */
function detectSnapEdge(bounds, workArea, threshold = EDGE_SNAP_THRESHOLD) {
  const { left, right } = edgeDistances(bounds, workArea);
  const candidates = [];
  if (left <= threshold) candidates.push({ edge: 'left', distance: left });
  if (right <= threshold) candidates.push({ edge: 'right', distance: right });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].edge;
}

/**
 * Prefer the horizontally closer work-area edge (for explicit Hide).
 */
function nearestHorizontalEdge(bounds, workArea) {
  const { left, right } = edgeDistances(bounds, workArea);
  return left <= right ? 'left' : 'right';
}

function clampY(y, height, workArea) {
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);
  return Math.min(Math.max(y, workArea.y), maxY);
}

/**
 * Fully visible bounds flush against the docked edge (same monitor).
 */
function expandedBounds(edge, bounds, workArea, fullWidth = DEFAULT_FULL_WIDTH) {
  const width = fullWidth;
  const height = bounds.height;
  const y = clampY(bounds.y, height, workArea);
  if (edge === 'left') {
    return { x: workArea.x, y, width, height };
  }
  return { x: workArea.x + workArea.width - width, y, width, height };
}

/**
 * Peek-strip bounds on the same monitor (resize, do not slide onto another display).
 */
function collapsedBounds(edge, bounds, workArea, peekSize = PEEK_SIZE) {
  const width = peekSize;
  const height = Math.max(bounds.height, peekSize * 3);
  const y = clampY(bounds.y, height, workArea);
  if (edge === 'left') {
    return { x: workArea.x, y, width, height };
  }
  return { x: workArea.x + workArea.width - width, y, width, height };
}

/**
 * Whether the cursor is still near the docked peek / expanded card.
 * Used to avoid collapse↔expand "fleeing" loops.
 */
function isCursorNearDock(edge, cursor, workArea, widgetBounds, fullWidth = DEFAULT_FULL_WIDTH) {
  if (!edge || !cursor || !workArea || !widgetBounds) return false;
  const pad = 24;
  const zoneWidth = Math.max(widgetBounds.width, fullWidth) + pad;
  const top = widgetBounds.y - pad;
  const bottom = widgetBounds.y + widgetBounds.height + pad;
  if (cursor.y < top || cursor.y > bottom) return false;

  if (edge === 'left') {
    return cursor.x >= workArea.x - pad && cursor.x <= workArea.x + zoneWidth;
  }
  const right = workArea.x + workArea.width;
  return cursor.x <= right + pad && cursor.x >= right - zoneWidth;
}

module.exports = {
  EDGE_SNAP_THRESHOLD,
  PEEK_SIZE,
  DEFAULT_FULL_WIDTH,
  VALID_EDGES,
  normalizeEdge,
  edgeDistances,
  detectSnapEdge,
  nearestHorizontalEdge,
  expandedBounds,
  collapsedBounds,
  isCursorNearDock,
  // Back-compat aliases used by older call sites / docs
  expandedPosition: (edge, bounds, workArea) => {
    const b = expandedBounds(edge, bounds, workArea);
    return { x: b.x, y: b.y };
  },
  collapsedPosition: (edge, bounds, workArea) => {
    const b = collapsedBounds(edge, bounds, workArea);
    return { x: b.x, y: b.y };
  },
};
