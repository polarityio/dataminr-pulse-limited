const { logging: { getLogger } } = require('polarity-integration-utils');

const { getAlerts } = require('./getAlerts');
const { getPollingState, updatePollingState } = require('./stateManager');
const { processAlerts } = require('./alertProcessor');

let isPollingAlertsInProgress = false;

/**
 * Poll the API for new alerts (single zip response; no pagination).
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Resolves with polling result object
 */
const pollAlerts = async (options) => {
  const Logger = getLogger();
  if (isPollingAlertsInProgress) return;
  isPollingAlertsInProgress = true;

  let totalAlertsProcessed = 0;

  try {
    Logger.debug('Starting Dataminr API poll (zip)');

    const state = getPollingState();
    const since = state.lastSince ?? 0;
    const { alerts, maxSince } = await getAlerts({ ...options, since });

    if (alerts.length > 0) {
      processAlerts(alerts, options);
      totalAlertsProcessed = alerts.length;
    }

    updatePollingState({
      lastPollTime: Date.now(),
      alertCount: totalAlertsProcessed,
      totalAlertsProcessed: state.totalAlertsProcessed + totalAlertsProcessed,
      lastSince: maxSince
    });

    Logger.debug(
      { totalAlertsFetched: alerts.length, totalAlertsProcessed },
      'Polling cycle completed'
    );
    isPollingAlertsInProgress = false;

    return {
      success: true,
      alertsProcessed: totalAlertsProcessed,
      hasMore: false
    };
  } catch (error) {
    isPollingAlertsInProgress = false;
    const statusCode = error.statusCode || (error.meta && error.meta.statusCode);
    if (statusCode === 429) {
      Logger.warn(
        { statusCode: 429, totalAlertsProcessed },
        'Rate limit exceeded during polling - will retry on next interval'
      );
      return {
        success: false,
        error: 'Rate limit exceeded - will retry on next poll interval'
      };
    }

    Logger.error(
      {
        statusCode: statusCode,
        message: error.message || error.detail || 'Unknown error',
        detail: error.detail,
        totalAlertsProcessed
      },
      'Polling Dataminr API Failed'
    );

    return {
      success: false,
      error: error.message || error.detail || 'Polling failed'
    };
  }
};

module.exports = pollAlerts;
