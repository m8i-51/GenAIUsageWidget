const EDGE_SNAP_THRESHOLD = 28;
const PEEK_SIZE = 28;
const DEFAULT_FULL_WIDTH = 300;
const DEFAULT_FULL_HEIGHT = 360;
const VALID_EDGES = new Set(['left', 'right', 'top']);

function normalizeEdge(edge) {
  if (VALID_EDGES.has(edge)) return edge;
  return null;
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 */
function edgeDistances(bounds, workArea) {
  return {
    left: bounds.x - workArea.x,
    right: (workArea.x + workArea.width) - (bounds.x + bounds.width),
    top: bounds.y - workArea.y,
  };
}

/**
 * Snap to the nearest work-area edge within threshold.
 * @returns {'left'|'right'|'top'|null}
 */
function detectSnapEdge(bounds, workArea, threshold = EDGE_SNAP_THRESHOLD) {
  const distances = edgeDistances(bounds, workArea);
  let best = null;
  let bestDist = Infinity;
  for (const edge of ['left', 'right', 'top']) {
    const d = distances[edge];
    if (d <= threshold && d < bestDist) {
      best = edge;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Prefer the nearest edge for the Hide button (ties break: top, then left, then right).
 */
function preferDockEdge(bounds, workArea) {
  if (!bounds || !workArea) return 'top';
  const distances = edgeDistances(bounds, workArea);
  let best = 'top';
  let bestDist = distances.top;
  for (const edge of ['left', 'right']) {
    if (distances[edge] < bestDist) {
      best = edge;
      bestDist = distances[edge];
    }
  }
  return best;
}

function clampX(x, width, workArea) {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
  return Math.min(Math.max(x, workArea.x), maxX);
}

function clampY(y, height, workArea) {
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);
  return Math.min(Math.max(y, workArea.y), maxY);
}

/**
 * Fully visible bounds flush against the docked edge (same monitor).
 */
function expandedBounds(edge, bounds, workArea, fullWidth = DEFAULT_FULL_WIDTH, fullHeight = DEFAULT_FULL_HEIGHT) {
  const width = fullWidth;
  const height = Math.max(fullHeight, 120);
  if (edge === 'left') {
    return { x: workArea.x, y: clampY(bounds.y, height, workArea), width, height };
  }
  if (edge === 'right') {
    return {
      x: workArea.x + workArea.width - width,
      y: clampY(bounds.y, height, workArea),
      width,
      height,
    };
  }
  // top
  return {
    x: clampX(bounds.x, width, workArea),
    y: workArea.y,
    width,
    height,
  };
}

/**
 * Peek strip along the docked edge (same monitor).
 * left/right → vertical strip; top → horizontal strip.
 */
function collapsedBounds(edge, bounds, workArea, peekSize = PEEK_SIZE, fullWidth = DEFAULT_FULL_WIDTH, fullHeight = DEFAULT_FULL_HEIGHT) {
  if (edge === 'left') {
    const height = Math.max(fullHeight, 120);
    return {
      x: workArea.x,
      y: clampY(bounds.y, height, workArea),
      width: peekSize,
      height,
    };
  }
  if (edge === 'right') {
    const height = Math.max(fullHeight, 120);
    return {
      x: workArea.x + workArea.width - peekSize,
      y: clampY(bounds.y, height, workArea),
      width: peekSize,
      height,
    };
  }
  // top
  return {
    x: clampX(bounds.x, fullWidth, workArea),
    y: workArea.y,
    width: fullWidth,
    height: peekSize,
  };
}

/**
 * Whether the cursor is still near the dock zone for the given edge.
 */
function isCursorNearDock(edge, cursor, workArea, widgetBounds, fullWidth = DEFAULT_FULL_WIDTH, fullHeight = DEFAULT_FULL_HEIGHT) {
  if (!edge || !cursor || !workArea || !widgetBounds) return false;
  const pad = 24;

  if (edge === 'top') {
    const left = Math.min(widgetBounds.x, clampX(widgetBounds.x, fullWidth, workArea)) - pad;
    const right = Math.max(widgetBounds.x + widgetBounds.width, left + fullWidth) + pad;
    if (cursor.x < left || cursor.x > right) return false;
    const zoneHeight = Math.max(widgetBounds.height, fullHeight) + pad;
    return cursor.y >= workArea.y - pad && cursor.y <= workArea.y + zoneHeight;
  }

  const top = Math.min(widgetBounds.y, clampY(widgetBounds.y, fullHeight, workArea)) - pad;
  const bottom = Math.max(widgetBounds.y + widgetBounds.height, top + Math.max(fullHeight, 120)) + pad;
  if (cursor.y < top || cursor.y > bottom) return false;

  if (edge === 'left') {
    const zoneWidth = Math.max(widgetBounds.width, fullWidth) + pad;
    return cursor.x >= workArea.x - pad && cursor.x <= workArea.x + zoneWidth;
  }

  // right
  const zoneWidth = Math.max(widgetBounds.width, fullWidth) + pad;
  return cursor.x >= workArea.x + workArea.width - zoneWidth && cursor.x <= workArea.x + workArea.width + pad;
}

module.exports = {
  EDGE_SNAP_THRESHOLD,
  PEEK_SIZE,
  DEFAULT_FULL_WIDTH,
  DEFAULT_FULL_HEIGHT,
  VALID_EDGES,
  normalizeEdge,
  edgeDistances,
  detectSnapEdge,
  preferDockEdge,
  expandedBounds,
  collapsedBounds,
  isCursorNearDock,
  expandedPosition: (edge, bounds, workArea) => {
    const b = expandedBounds(edge, bounds, workArea);
    return { x: b.x, y: b.y };
  },
  collapsedPosition: (edge, bounds, workArea) => {
    const b = collapsedBounds(edge, bounds, workArea);
    return { x: b.x, y: b.y };
  },
};
