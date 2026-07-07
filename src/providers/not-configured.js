// Marks an error as "this provider just isn't set up on this machine",
// so the UI can hide the card instead of showing an error state.
function notConfigured(message) {
  const err = new Error(message);
  err.notConfigured = true;
  return err;
}

module.exports = { notConfigured };
