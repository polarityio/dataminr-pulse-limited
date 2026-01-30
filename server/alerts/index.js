const { getAlerts, getAlertById } = require('./getAlerts');
const pollAlerts = require('./pollAlerts');

const {
  resetPollingState,
  getCachedAlerts,
  addAlertsToCache,
  clearCachedAlerts
} = require('./stateManager');

module.exports = {
  getAlerts,
  getAlertById,
  pollAlerts,
  resetPollingState,
  getCachedAlerts,
  addAlertsToCache,
  clearCachedAlerts
};
