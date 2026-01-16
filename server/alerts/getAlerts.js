const {
  logging: { getLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { requestWithDefaults } = require('../request');
const { DEFAULT_PAGE_SIZE, ROUTE_PREFIX } = require('../constants');
const { getCachedAlerts } = require('./stateManager');

const parseNextPageCursor = (nextPage) => {
  try {
    if (!nextPage) return null;
    const urlParts = nextPage.split('?');
    if (urlParts.length > 1) {
      const urlParams = new URLSearchParams(urlParts[1]);
      return urlParams.get('from');
    }
  } catch (error) {
    const Logger = getLogger();
    Logger.warn({ error, nextPage }, 'Failed to parse nextPage URL for cursor');
  }
};

const parsePreviousPageCursor = (previousPage) => {
  try {
    if (!previousPage) return null;
    const urlParts = previousPage.split('?');
    if (urlParts.length > 1) {
      const urlParams = new URLSearchParams(urlParts[1]);
      return urlParams.get('to');
    }
  } catch (error) {
    const Logger = getLogger();
    Logger.warn({ error, previousPage }, 'Failed to parse previousPage URL for cursor');
    return null;
  }
};

/**
 * Get alerts from the API with pagination support
 * @param {Object} options - Configuration options
 * @param {string} options.url - Base URL for the API
 * @param {Object} parameters - Optional parameters for the query
 * @param {Array<string>} [parameters.listIds] - Optional array of list IDs to filter alerts
 * @param {string} [parameters.to] - Optional cursor value from previousPage URL's 'to' parameter for fetching alerts before this point
 * @param {string} [parameters.from] - Optional cursor value from nextPage URL's 'from' parameter for fetching alerts after this point
 * @param {number} [parameters.pageSize] - Optional number of alerts to return (overrides timestamp on first query)
 * @returns {Promise<Object>} Resolves with object containing alerts array and pagination info
 * @returns {Array<Object>} returns.alerts - Array of alert objects
 * @returns {string|null} returns.nextPageCursor - Next page URL or null
 * @returns {string|null} returns.previousPageCursor - Previous page URL or null
 */
const getAlerts = async (
  options,
  { listIds = null, to = null, from = null, pageSize = null } = {}
) => {
  const Logger = getLogger();

  try {
    // Use pageSize if it exists and is greater than DEFAULT_PAGE_SIZE, otherwise use DEFAULT_PAGE_SIZE
    const effectivePageSize =
      typeof pageSize === 'number' && pageSize > DEFAULT_PAGE_SIZE
        ? pageSize
        : DEFAULT_PAGE_SIZE;

    const queryParams = { pageSize: effectivePageSize };

    // Add pagination cursor if provided - prefer "from" over "to" if both are provided
    // If pageSize is specified, only add the cursor if it is not the initial query
    if (!pageSize) {
      if (from) {
        queryParams.from = from;
      } else if (to) {
        queryParams.to = to;
      }
    }

    // Add list IDs if configured
    if (listIds && listIds.length > 0) {
      queryParams.lists = listIds.join(',');
    }

    const fullUrl = `${options.url}/${ROUTE_PREFIX}/v1/alerts`;
    Logger.debug(
      {
        url: fullUrl,
        queryParams
      },
      'Fetching alerts from the Dataminr API'
    );

    const response = await requestWithDefaults({
      route: `${ROUTE_PREFIX}/v1/alerts`,
      options,
      qs: queryParams,
      method: 'GET'
    });

    const alerts = (response.body && response.body.alerts) || [];
    const nextPage = (response.body && response.body.nextPage) || null;
    const previousPage = (response.body && response.body.previousPage) || null;

    Logger.debug(
      {
        alertTimestamps: alerts.map((alert) => alert.alertTimestamp).slice(0, 3),
        statusCode: response.statusCode,
        nextPage: nextPage,
        previousPage: previousPage,
        alertCount: alerts.length,
        pageSize: pageSize
      },
      'Dataminr API response received'
    );

    return {
      alerts: alerts,
      nextPage: nextPage,
      previousPage: previousPage,
      nextPageCursor: parseNextPageCursor(nextPage),
      previousPageCursor: parsePreviousPageCursor(previousPage)
    };
  } catch (error) {
    // Handle rate limiting (429) with a cleaner message
    const statusCode = error.statusCode || (error.meta && error.meta.statusCode);
    const message = error.message || error.detail || 'Unknown error';
    if (statusCode === 429 || statusCode === '429' || message.contains('429')) {
      Logger.warn(
        {
          statusCode: 429,
          message: 'Rate limit exceeded - too many requests to Dataminr API'
        },
        'Rate limit exceeded while fetching alerts'
      );
      // Return empty results instead of throwing for rate limits
      return {
        alerts: [],
        nextPage: null,
        previousPage: null,
        nextPageCursor: null,
        previousPageCursor: null
      };
    }

    // For other errors, log with minimal stack trace info
    Logger.error(
      {
        statusCode: statusCode,
        message: message,
        detail: error.detail
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
 * @param {Array<string>} [options.listIds] - Optional array of list IDs to include match reasons
 * @returns {Promise<Object>} Resolves with alert object
 */
const getAlertById = async (alertId, options) => {
  const Logger = getLogger();
  let listIds = null;

  if (!alertId) {
    throw new Error('Alert ID is required');
  }

  if (options && options.listIds) {
    listIds = options.listIds;
  }

  const cachedAlerts = getCachedAlerts(listIds);
  const cachedAlert = cachedAlerts.find((alert) => alert.alertId === alertId);

  if (cachedAlert) {
    Logger.debug({ alertId }, 'Alert found in cache');
    return cachedAlert;
  }

  try {
    const queryParams = {};

    // Add list IDs if configured (to include match reasons)
    if (listIds && listIds.length > 0) {
      queryParams.lists = listIds.join(',');
    }

    const route = `${ROUTE_PREFIX}/v1/alerts/${encodeURIComponent(alertId)}`;
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
