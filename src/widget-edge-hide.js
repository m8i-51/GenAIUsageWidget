const EDGE_SNAP_THRESHOLD = 28;
const PEEK_SIZE = 22;
const VALID_EDGES = new Set(['left', 'right']);

function normalizeEdge(edge) {
  return VALID_EDGES.has(edge) ? edge : null;
}

/**
 * Distance from window bounds to each horizontal work-area edge.
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
  return Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height);
}

/**
 * Fully visible position flush against the docked edge.
 */
function expandedPosition(edge, bounds, workArea) {
  const y = clampY(bounds.y, bounds.height, workArea);
  if (edge === 'left') {
    return { x: workArea.x, y };
  }
  return { x: workArea.x + workArea.width - bounds.width, y };
}

/**
 * Mostly off-screen position with a thin peek remaining on-screen.
 */
function collapsedPosition(edge, bounds, workArea) {
  const y = clampY(bounds.y, bounds.height, workArea);
  if (edge === 'left') {
    return { x: workArea.x - bounds.width + PEEK_SIZE, y };
  }
  return { x: workArea.x + workArea.width - PEEK_SIZE, y };
}

module.exports = {
  EDGE_SNAP_THRESHOLD,
  PEEK_SIZE,
  VALID_EDGES,
  normalizeEdge,
  edgeDistances,
  detectSnapEdge,
  nearestHorizontalEdge,
  expandedPosition,
  collapsedPosition,
};
