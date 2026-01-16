const searchAlerts = require('./searchAlerts');
const { getAlerts, getAlertById } = require('./getAlerts');
const { pollLists, parseListConfig } = require('./pollLists');
const pollAlerts = require('./pollAlerts');

const {
  resetPollingState,
  getCachedAlerts,
  addAlertsToCache,
  clearCachedAlerts
} = require('./stateManager');

module.exports = {
  searchAlerts,
  getAlerts,
  getAlertById,
  pollLists,
  pollAlerts,
  resetPollingState,
  parseListConfig,
  getCachedAlerts,
  addAlertsToCache,
  clearCachedAlerts
};
