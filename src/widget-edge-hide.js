const EDGE_SNAP_THRESHOLD = 28;
const PEEK_SIZE = 28;
const DEFAULT_FULL_WIDTH = 300;
const DEFAULT_FULL_HEIGHT = 360;
const VALID_EDGES = new Set(['top']);

function normalizeEdge(edge) {
  // Migrate older left/right dock settings to top.
  if (edge === 'left' || edge === 'right' || edge === 'top') return 'top';
  return null;
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 */
function edgeDistances(bounds, workArea) {
  return {
    top: bounds.y - workArea.y,
  };
}

/**
 * Snap only to the top work-area edge.
 */
function detectSnapEdge(bounds, workArea, threshold = EDGE_SNAP_THRESHOLD) {
  const { top } = edgeDistances(bounds, workArea);
  if (top <= threshold) return 'top';
  return null;
}

/** Hide / dock target is always the top edge. */
function preferDockEdge() {
  return 'top';
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
 * Fully visible bounds flush against the top edge (same monitor).
 */
function expandedBounds(edge, bounds, workArea, fullWidth = DEFAULT_FULL_WIDTH, fullHeight = DEFAULT_FULL_HEIGHT) {
  const width = fullWidth;
  const height = Math.max(fullHeight, 120);
  const x = clampX(bounds.x, width, workArea);
  if (edge === 'top') {
    return { x, y: workArea.y, width, height };
  }
  // Fallback (should not happen with top-only docks).
  return { x, y: clampY(bounds.y, height, workArea), width, height };
}

/**
 * Horizontal peek strip along the top edge (same monitor).
 */
function collapsedBounds(edge, bounds, workArea, peekSize = PEEK_SIZE, fullWidth = DEFAULT_FULL_WIDTH) {
  const width = fullWidth;
  const height = peekSize;
  const x = clampX(bounds.x, width, workArea);
  if (edge === 'top') {
    return { x, y: workArea.y, width, height };
  }
  return { x, y: workArea.y, width, height };
}

/**
 * Whether the cursor is still near the top dock zone.
 */
function isCursorNearDock(edge, cursor, workArea, widgetBounds, fullWidth = DEFAULT_FULL_WIDTH, fullHeight = DEFAULT_FULL_HEIGHT) {
  if (!edge || !cursor || !workArea || !widgetBounds) return false;
  const pad = 24;
  const left = Math.min(widgetBounds.x, clampX(widgetBounds.x, fullWidth, workArea)) - pad;
  const right = Math.max(widgetBounds.x + widgetBounds.width, left + fullWidth) + pad;
  if (cursor.x < left || cursor.x > right) return false;

  const zoneHeight = Math.max(widgetBounds.height, fullHeight) + pad;
  return cursor.y >= workArea.y - pad && cursor.y <= workArea.y + zoneHeight;
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
