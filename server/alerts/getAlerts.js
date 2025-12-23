const {
  logging: { getLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { requestWithDefaults } = require('../request');
const { MAX_PAGE_SIZE } = require('../constants');
const { getCachedAlerts } = require('./stateManager');

/**
 * Get alerts from the API with pagination support
 * @param {Object} options - Configuration options
 * @param {string} options.url - Base URL for the API
 * @param {string} options.routePrefix - Route prefix for the API (e.g., 'firstalert' or 'pulse')
 * @param {Array<string>} [options.listIds] - Optional array of list IDs to filter alerts
 * @param {string} [paginationCursor] - Optional pagination cursor for fetching next page
 * @param {number} [count] - Optional number of alerts to return (overrides timestamp on first query)
 * @param {string} [sinceTimestamp] - Optional ISO timestamp to filter alerts (returns alerts after this timestamp)
 * @returns {Promise<Object>} Resolves with object containing alerts array and pagination info
 * @returns {Array<Object>} returns.alerts - Array of alert objects
 * @returns {string|null} returns.nextPage - Next page URL or null
 * @returns {string|null} returns.previousPage - Previous page URL or null
 */
const getAlerts = async (
  options,
  paginationCursor = null,
  count = null,
  sinceTimestamp = null
) => {
  const Logger = getLogger();

  try {
    // Use count as pageSize if it exists and is greater than MAX_PAGE_SIZE, otherwise use MAX_PAGE_SIZE
    const pageSize = count && count > MAX_PAGE_SIZE ? count : MAX_PAGE_SIZE;

    const queryParams = {
      pageSize: pageSize
    };

    // Add pagination cursor if provided (but not if count is specified for initial query)
    if (paginationCursor && !count) {
      queryParams.from = paginationCursor;
    }

    // Add list IDs if configured
    if (options.listIds && options.listIds.length > 0) {
      queryParams.lists = options.listIds.join(',');
    }

    const fullUrl = `${options.url}/${options.routePrefix}/v1/alerts`;
    Logger.debug(
      {
        url: fullUrl,
        queryParams,
        hasCursor: !!paginationCursor,
        count: count,
        sinceTimestamp: sinceTimestamp
      },
      'Fetching alerts from the Dataminr API'
    );

    const response = await requestWithDefaults({
      route: `${options.routePrefix}/v1/alerts`,
      options,
      qs: queryParams,
      method: 'GET'
    });

    let alerts = (response.body && response.body.alerts) || [];

    // Filter alerts by timestamp if sinceTimestamp is provided and count is not (count overrides timestamp)
    if (sinceTimestamp && !count) {
      const sinceDate = new Date(sinceTimestamp);
      alerts = alerts.filter((alert) => {
        if (!alert.alertTimestamp) {
          return false;
        }
        const alertDate = new Date(alert.alertTimestamp);
        return alertDate > sinceDate;
      });
    }

    Logger.debug(
      {
        statusCode: response.statusCode,
        alertCount: alerts.length,
        originalAlertCount:
          response.body && response.body.alerts ? response.body.alerts.length : 0,
        hasNextPage: !!(response.body && response.body.nextPage),
        hasPreviousPage: !!(response.body && response.body.previousPage),
        filteredByTimestamp: !!(sinceTimestamp && !count),
        pageSize: pageSize
      },
      'Dataminr API response received'
    );

    const rawAlertCount = response.body && response.body.alerts ? response.body.alerts.length : 0;

    return {
      alerts: alerts,
      nextPage: (response.body && response.body.nextPage) || null,
      previousPage: (response.body && response.body.previousPage) || null,
      rawAlertCount: rawAlertCount // Count of alerts fetched from API before filtering
    };
  } catch (error) {
    const err = parseErrorToReadableJson(error);
    Logger.error(
      {
        formattedError: err,
        error
      },
      'Getting Alerts Failed'
    );
    throw error;
  }
};

/**
 * Get a single alert by ID from the API
 * @param {string} alertId - Alert ID to fetch
 * @param {Object} options - Configuration options
 * @param {string} options.url - Base URL for the API
 * @param {string} options.routePrefix - Route prefix for the API (e.g., 'firstalert' or 'pulse')
 * @param {Array<string>} [options.listIds] - Optional array of list IDs to include match reasons
 * @returns {Promise<Object>} Resolves with alert object
 */
const getAlertById = async (alertId, options) => {
  const Logger = getLogger();

  if (!alertId) {
    throw new Error('Alert ID is required');
  }

  const cachedAlerts = getCachedAlerts();
  const cachedAlert = cachedAlerts.find((alert) => alert.alertId === alertId);

  if (cachedAlert) {
    Logger.debug({ alertId }, 'Alert found in cache');
    return cachedAlert;
  }

  try {
    const queryParams = {};

    // Add list IDs if configured (to include match reasons)
    if (options.listIds && options.listIds.length > 0) {
      queryParams.lists = options.listIds.join(',');
    }

    const route = `${options.routePrefix}/v1/alerts/${encodeURIComponent(alertId)}`;
    const fullUrl = `${options.url}/${route}`;
    Logger.debug(
      {
        route,
        fullUrl,
        queryParams,
        alertId,
        encodedAlertId: encodeURIComponent(alertId)
      },
      'Fetching alert by ID from Dataminr API'
    );

    const response = await requestWithDefaults({
      route,
      options,
      qs: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      method: 'GET'
    });

    Logger.debug(
      {
        statusCode: response.statusCode,
        responseBody: response.body,
        hasAlerts: !!(response.body && response.body.alerts),
        hasAlertId: !!(response.body && response.body.alertId),
        alertsLength:
          response.body && response.body.alerts ? response.body.alerts.length : 0
      },
      'Dataminr API response received for alert by ID'
    );

    // Handle 404 - alert not found
    if (response.statusCode === 404) {
      Logger.warn({ alertId }, 'Alert not found (404)');
      return null;
    }

    // The API can return the alert in two formats:
    // 1. Wrapped in an AlertResponse object with an alerts array: { alerts: [alert] }
    // 2. Directly as an alert object: { alertId: "...", headline: "...", ... }
    if (response.body) {
      // Check if it's wrapped in an alerts array (AlertResponse format)
      if (response.body.alerts && Array.isArray(response.body.alerts)) {
        if (response.body.alerts.length > 0) {
          return response.body.alerts[0];
        } else {
          Logger.warn(
            { alertId, responseBody: response.body },
            'Alert response contains empty alerts array'
          );
          return null;
        }
      }

      // Check if it's a direct alert object (has alertId property)
      if (response.body.alertId) {
        return response.body;
      }
    }

    Logger.warn(
      { alertId, responseBody: response.body, statusCode: response.statusCode },
      'Unexpected response structure from the Dataminr API'
    );
    return null;
  } catch (error) {
    const err = parseErrorToReadableJson(error);

    // Check if it's a 404 error
    if (error.statusCode === 404 || (error.meta && error.meta.statusCode === 404)) {
      Logger.warn({ alertId }, 'Alert not found (404 error)');
      return null;
    }

    Logger.error(
      {
        formattedError: err,
        error,
        alertId,
        errorStatus: error.statusCode || (error.meta && error.meta.statusCode),
        errorBody: error.body || (error.meta && error.meta.body)
      },
      'Getting Alert by ID Failed'
    );
    throw error;
  }
};

module.exports = {
  getAlerts,
  getAlertById
};
