const EDGE_SNAP_THRESHOLD = 28;
/** Collapsed pill thickness; matches the 84px widget notch. */
const PEEK_SIZE = 84;
/** Collapsed left/right pill width: 56 ring + 12 pad + 1 border. */
const SIDE_PILL_WIDTH = 69;
/** Allow a tighter side pill than PEEK_SIZE once content is measured. */
const MIN_WIDGET_SIZE = 64;
const DEFAULT_FULL_WIDTH = 108;
const DEFAULT_FULL_HEIGHT = 360;
/** Top/bottom collapsed size: four 56px rings plus labels. */
const COLLAPSED_TOP_WIDTH = 288;
const COLLAPSED_TOP_HEIGHT = 100;
/** Left/right collapsed height: 4 rings (56+label) + gaps + padding. */
const COLLAPSED_SIDE_HEIGHT = 340;
const VALID_EDGES = new Set(['left', 'right', 'top', 'bottom']);

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
    bottom: (workArea.y + workArea.height) - (bounds.y + bounds.height),
  };
}

/**
 * Snap to the nearest work-area edge within threshold.
 * @returns {'left'|'right'|'top'|'bottom'|null}
 */
function detectSnapEdge(bounds, workArea, threshold = EDGE_SNAP_THRESHOLD) {
  const distances = edgeDistances(bounds, workArea);
  let best = null;
  let bestDist = Infinity;
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const d = distances[edge];
    if (d <= threshold && d < bestDist) {
      best = edge;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Prefer the nearest edge for the Hide button (ties break: top, bottom, left, right).
 */
function preferDockEdge(bounds, workArea) {
  if (!bounds || !workArea) return 'top';
  const distances = edgeDistances(bounds, workArea);
  let best = 'top';
  let bestDist = distances.top;
  for (const edge of ['bottom', 'left', 'right']) {
    if (distances[edge] < bestDist) {
      best = edge;
      bestDist = distances[edge];
    }
  }
  return best;
}

function horizontalCenterX(bounds, width, workArea) {
  const centerX = bounds.x + bounds.width / 2;
  return clampX(centerX - width / 2, width, workArea);
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
 * @param edgeArea optional monitor frame for the docked axis (defaults to workArea)
 */
function expandedBounds(edge, bounds, workArea, fullWidth = DEFAULT_FULL_WIDTH, fullHeight = DEFAULT_FULL_HEIGHT, edgeArea = null) {
  const flush = edgeArea || workArea;
  const width = fullWidth;
  const height = Math.max(fullHeight, 120);
  if (edge === 'left') {
    return { x: flush.x, y: clampY(bounds.y, height, workArea), width, height };
  }
  if (edge === 'right') {
    return {
      x: flush.x + flush.width - width,
      y: clampY(bounds.y, height, workArea),
      width,
      height,
    };
  }
  if (edge === 'top') {
    return {
      x: horizontalCenterX(bounds, width, workArea),
      y: flush.y,
      width,
      height,
    };
  }
  // bottom
  return {
    x: horizontalCenterX(bounds, width, workArea),
    y: flush.y + flush.height - height,
    width,
    height,
  };
}

/**
 * Collapsed pill along the docked edge (same monitor).
 * left/right → vertical pill sized to the rings; top/bottom → horizontal pill.
 */
function collapsedBounds(edge, bounds, workArea, peekSize = PEEK_SIZE, fullWidth = DEFAULT_FULL_WIDTH, pillSpan = COLLAPSED_SIDE_HEIGHT, edgeArea = null) {
  const flush = edgeArea || workArea;
  if (edge === 'left') {
    const height = Math.max(peekSize, pillSpan);
    return {
      x: flush.x,
      y: clampY(bounds.y, height, workArea),
      width: peekSize,
      height,
    };
  }
  if (edge === 'right') {
    const height = Math.max(peekSize, pillSpan);
    return {
      x: flush.x + flush.width - peekSize,
      y: clampY(bounds.y, height, workArea),
      width: peekSize,
      height,
    };
  }
  if (edge === 'top') {
    const width = Math.max(fullWidth, COLLAPSED_TOP_WIDTH);
    return {
      x: horizontalCenterX(bounds, width, workArea),
      y: flush.y,
      width,
      height: Math.max(peekSize, COLLAPSED_TOP_HEIGHT),
    };
  }
  // bottom: horizontal pill
  const width = Math.max(fullWidth, COLLAPSED_TOP_WIDTH);
  const height = Math.max(peekSize, COLLAPSED_TOP_HEIGHT);
  return {
    x: horizontalCenterX(bounds, width, workArea),
    y: flush.y + flush.height - height,
    width,
    height,
  };
}

/**
 * Whether the cursor is still near the dock zone for the given edge.
 */
function isCursorNearDock(edge, cursor, workArea, widgetBounds, fullWidth = DEFAULT_FULL_WIDTH, fullHeight = DEFAULT_FULL_HEIGHT) {
  if (!edge || !cursor || !workArea || !widgetBounds) return false;
  const pad = 24;

  if (edge === 'top') {
    const left = Math.min(widgetBounds.x, horizontalCenterX(widgetBounds, fullWidth, workArea)) - pad;
    const right = Math.max(widgetBounds.x + widgetBounds.width, left + fullWidth) + pad;
    if (cursor.x < left || cursor.x > right) return false;
    const zoneHeight = Math.max(widgetBounds.height, fullHeight) + pad;
    return cursor.y >= workArea.y - pad && cursor.y <= workArea.y + zoneHeight;
  }

  if (edge === 'bottom') {
    const left = Math.min(widgetBounds.x, horizontalCenterX(widgetBounds, fullWidth, workArea)) - pad;
    const right = Math.max(widgetBounds.x + widgetBounds.width, left + fullWidth) + pad;
    if (cursor.x < left || cursor.x > right) return false;
    const zoneBottom = workArea.y + workArea.height;
    const zoneHeight = Math.max(widgetBounds.height, fullHeight) + pad;
    return cursor.y >= zoneBottom - zoneHeight && cursor.y <= zoneBottom + pad;
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

/**
 * After the widget window moved, what should happen to edge-hide.
 * An expanded docked widget sits flush on the edge (distance 0). That
 * must not be treated as a new drag-to-edge hide, or peek-open immediately
 * collapses again.
 *
 * @param {{ dockedEdge: 'left'|'right'|'top'|'bottom'|null, expanded: boolean, detectedEdge: 'left'|'right'|'top'|'bottom'|null }} state
 * @returns {'ignore'|'keep-expanded'|'undock'|'dock-collapse'|'save-bounds'}
 */
function decideMoveSnap({ dockedEdge, expanded, detectedEdge }) {
  if (dockedEdge && !expanded) return 'ignore';
  if (dockedEdge && expanded && detectedEdge === dockedEdge) return 'keep-expanded';
  if (dockedEdge && expanded && !detectedEdge) return 'undock';
  if (detectedEdge) return 'dock-collapse';
  return 'save-bounds';
}

module.exports = {
  EDGE_SNAP_THRESHOLD,
  PEEK_SIZE,
  SIDE_PILL_WIDTH,
  MIN_WIDGET_SIZE,
  COLLAPSED_TOP_WIDTH,
  COLLAPSED_TOP_HEIGHT,
  COLLAPSED_SIDE_HEIGHT,
  DEFAULT_FULL_WIDTH,
  DEFAULT_FULL_HEIGHT,
  VALID_EDGES,
  normalizeEdge,
  edgeDistances,
  detectSnapEdge,
  preferDockEdge,
  horizontalCenterX,
  expandedBounds,
  collapsedBounds,
  isCursorNearDock,
  decideMoveSnap,
  expandedPosition: (edge, bounds, workArea) => {
    const b = expandedBounds(edge, bounds, workArea);
    return { x: b.x, y: b.y };
  },
  collapsedPosition: (edge, bounds, workArea) => {
    const b = collapsedBounds(edge, bounds, workArea);
    return { x: b.x, y: b.y };
  },
};
