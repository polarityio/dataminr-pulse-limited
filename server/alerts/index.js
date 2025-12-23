const searchAlerts = require('./searchAlerts');
const { getAlerts, getAlertById } = require('./getAlerts');
const { getLists } = require('./getLists');
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
  getLists,
  getAlertById,
  pollAlerts,
  resetPollingState,
  getCachedAlerts,
  addAlertsToCache,
  clearCachedAlerts
};
