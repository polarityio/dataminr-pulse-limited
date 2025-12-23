const {
  logging: { getLogger }
} = require('polarity-integration-utils');

const { addAlertsToCache } = require('./stateManager');

/**
 * Process alerts from the API and store them in the global cache
 * @param {Array<Object>} alerts - Array of alert objects to process
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Resolves with processing result
 * @returns {number} returns.processed - Total alerts processed
 * @returns {number} returns.newAlerts - Number of new alerts added
 * @returns {number} returns.duplicates - Number of duplicate alerts
 */
const processAlerts = async (alerts, options) => {
  const Logger = getLogger();

  try {
    // Add alerts to global cache (deduplication handled in stateManager)
    const result = addAlertsToCache(alerts);

    Logger.debug(
      {
        totalAlerts: result.total,
        newAlertsAdded: result.added,
        duplicateAlerts: alerts.length - result.added
      },
      'Alerts processed and stored globally'
    );

    // Log individual alert details
    alerts.forEach((alert) => {
      Logger.debug(
        {
          alertId: alert.alertId,
          alertTimestamp: alert.alertTimestamp,
          alertType: alert.alertType && alert.alertType.name,
          headline: alert.headline
        },
        'Processing alert'
      );
    });

    return {
      processed: alerts.length,
      newAlerts: result.added,
      duplicates: alerts.length - result.added
    };
  } catch (error) {
    Logger.error({ error }, 'Error processing alerts');
    throw error;
  }
};

module.exports = {
  processAlerts
};

