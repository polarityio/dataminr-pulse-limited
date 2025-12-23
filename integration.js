const {
  logging: { setLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { validateOptions } = require('./server/userOptions');
const { removePrivateIps } = require('./server/dataTransformations');
const {
  pollAlerts,
  resetPollingState,
  searchAlerts,
  getAlertById
} = require('./server/alerts');
const { getCachedAlerts, getPollingState } = require('./server/alerts/stateManager');
const { getAlerts } = require('./server/alerts/getAlerts');
const { setLogger: setRequestLogger } = require('./server/request');
const {
  renderAlertDetail,
  renderAlertNotification
} = require('./server/templateRenderer');
const { getLists } = require('./server/alerts/getLists');

const assembleLookupResults = require('./server/assembleLookupResults');

let pollingInterval = null;
let Logger = null;
let pollingInitialized = false;
const routePrefix = 'pulse';
const defaultAlertTypesToWatch = ['flash', 'urgent', 'alert'];

/**
 * Initialize polling for alerts
 * @param {Object} options - Configuration options containing clientId, clientSecret, and pollInterval
 * @returns {Promise<void>} Resolves when polling is initialized
 */
const initializePolling = async (options) => {
  if (pollingInitialized) {
    return;
  }

  // Validate that required options are present
  if (!options.clientId || !options.clientSecret) {
    Logger.warn('Client ID or Client Secret not configured. Polling will not start.');
    Logger.debug('Options', options);
    return;
  }

  // Reset polling state on first initialization
  resetPollingState();

  // Add route prefix to options
  const optionsWithRoute = { ...options, routePrefix: routePrefix };

  // Start polling immediately
  try {
    await pollAlerts(optionsWithRoute);
  } catch (error) {
    Logger.error({ error }, 'Initial poll failed, but continuing with interval polling');
  }

  // Set up polling interval
  const pollIntervalMs = options.pollInterval * 1000; // Convert seconds to milliseconds

  pollingInterval = setInterval(async () => {
    try {
      await pollAlerts(optionsWithRoute);
    } catch (error) {
      Logger.error({ error }, 'Error in polling interval');
    }
  }, pollIntervalMs);

  pollingInitialized = true;

  Logger.info({ pollIntervalSeconds: options.pollInterval }, 'Polling started');
};

/**
 * Perform Pulse lookup for entities and return matching alerts
 * @param {Array<Object>} entities - Array of entity objects to search for
 * @param {Object} options - Configuration options
 * @param {Function} cb - Callback function (error, results)
 * @returns {Promise<void>} Resolves when lookup is complete
 */
const doLookup = async (entities, options, cb) => {
  try {
    // Only gets run in the Pulse integration - FirstAlert has no configured entities
    Logger.debug({ entities }, 'Entities');

    const searchableEntities = removePrivateIps(entities);

    // Add route prefix to options
    const optionsWithRoute = { ...options, routePrefix: routePrefix };
    const alerts = await searchAlerts(searchableEntities, optionsWithRoute);

    Logger.trace({ alerts, searchableEntities });

    // For trial version: return count with trial message instead of real results
    const lookupResults = entities.map((entity) => {
      // Find alerts for this entity (alerts structure: [{resultId, result: [...]}, ...])
      const entityResult = alerts.find(
        (alertResult) => alertResult.resultId === entity.value
      );
      const alertCount = entityResult && Array.isArray(entityResult.result)
        ? entityResult.result.length
        : 0;

      return {
        entity,
        data: alertCount > 0
          ? {
              summary: [`Alerts: ${alertCount}`],
              details: {
                limitedMessage: {
                  text: 'Pulse has additional alerts! Interested in gaining more from Dataminr, contact us at ',
                  email: 'sales@dataminr.com'
                },
                alertCount: alertCount,
                alerts: [] // Empty array - no real results for trial
              }
            }
          : null
      };
    });

    Logger.info({ lookupResults }, 'Lookup Results (Limited Mode)');

    cb(null, lookupResults);
  } catch (error) {
    const err = parseErrorToReadableJson(error);

    Logger.error({ error, formattedError: err }, 'Get Lookup Results Failed');
    cb({ detail: error.detail || error.message || 'Lookup Failed', err });
  }
};

/**
 * Initialize the integration on startup
 * @param {Object} logger - Logger instance for logging
 * @returns {Promise<void>} Resolves when startup is complete
 */
const startup = async (logger) => {
  Logger = logger;

  // Set up logger
  setLogger(Logger);
  setRequestLogger(Logger);

  Logger.warn('Dataminr integration starting up');
  // Polling will be initialized on first doLookup call when options are available
};

/**
 * Cleanup resources and stop polling on shutdown
 * @returns {void}
 */
const shutdown = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    pollingInitialized = false;
    Logger.info('Polling stopped');
  }
};

/**
 * Handle incoming messages from the client
 * @param {Object} payload - Message payload containing action and other data
 * @param {string} payload.action - Action to perform ('getAlerts', 'getAlertById')
 * @param {string} payload.sinceTimestamp - Optional ISO timestamp to filter alerts (returns alerts after this timestamp)
 * @param {number} payload.count - Optional number of alerts to return (overrides timestamp on first query)
 * @param {string} payload.alertId - Optional alert ID to get
 * @param {Object} options - Configuration options
 * @param {Function} cb - Callback function (error, result)
 * @returns {Promise<void>} Resolves when message is handled
 */
const onMessage = async (payload, options, cb) => {
  try {
    // Initialize polling on first message if not already initialized
    await initializePolling(options);

    const { action } = payload;

    if (!action) {
      return cb({ detail: 'Missing action in payload' });
    }

    const username = options._request.user.username;

    switch (action) {
      case 'getAlerts':
        // Extract parameters from payload
        const { sinceTimestamp, count: countParam, listIds: listIdsParam } = payload;

        // Parse count parameter (from URL or payload)
        const alertCount = countParam ? parseInt(countParam, 10) : null;

        // Parse listIds (comma-separated string or array)
        let listIds = null;
        if (listIdsParam) {
          if (typeof listIdsParam === 'string') {
            // Parse comma-separated string, filter out empty strings and '0'
            listIds = listIdsParam
              .split(',')
              .map((id) => id.trim())
              .filter((id) => id && id !== '0');
          } else if (Array.isArray(listIdsParam)) {
            // Filter out empty strings and '0'
            listIds = listIdsParam.filter((id) => id && id !== '0');
          }
          // If listIds is empty after filtering, set to null (no filtering)
          if (listIds.length === 0) {
            listIds = null;
          }
        }

        // Use provided timestamp or default to current time if not provided
        const queryTimestamp = sinceTimestamp || new Date().toISOString();

        // Get configured alert types to watch (default to all if not configured)
        const alertTypesToWatch = (options.setAlertTypesToWatch && 
                                   options.setAlertTypesToWatch.length > 0)
          ? options.setAlertTypesToWatch
          : defaultAlertTypesToWatch;
        // Normalize to lowercase for comparison
        // Handle both string arrays and object arrays with {value, display} structure
        const normalizedAlertTypesToWatch = alertTypesToWatch.map((type) => {
          // If it's an object with a value property, use that
          if (type && typeof type === 'object' && type.value) {
            return typeof type.value === 'string' ? type.value.toLowerCase() : String(type.value).toLowerCase();
          }
          // Otherwise treat as string
          return typeof type === 'string' ? type.toLowerCase() : String(type).toLowerCase();
        });

        // Helper function to check if alert type should be included
        const shouldIncludeAlert = (alert) => {
          if (!normalizedAlertTypesToWatch || normalizedAlertTypesToWatch.length === 0) {
            return true; // Include all if no filter configured
          }
          const alertTypeName = alert.alertType && alert.alertType.name
            ? alert.alertType.name.toLowerCase()
            : 'alert';
          return normalizedAlertTypesToWatch.indexOf(alertTypeName) !== -1;
        };

        try {
          // Get alerts from global cache (filtered by listIds if provided)
          const cachedAlerts = getCachedAlerts(listIds);

          // Filter cached alerts by alert type
          const filteredCachedAlerts = cachedAlerts.filter(shouldIncludeAlert);

          // Check if we need to query API (only if count is requested and cache doesn't have enough)
          const needsApiQuery = alertCount && filteredCachedAlerts.length < alertCount;

          let alerts;

          if (needsApiQuery) {
            // Create options with listIds and route prefix for API query
            const queryOptions = {
              ...options,
              listIds: listIds,
              routePrefix: routePrefix
            };

            // Query API for alerts (count overrides timestamp for initial query)
            const { alerts: apiAlerts } = await getAlerts(
              queryOptions,
              null, // No pagination cursor for user queries
              alertCount, // Count parameter (overrides timestamp if provided)
              null // Timestamp ignored when count is provided
            );

            // Filter API alerts by alert type
            alerts = apiAlerts.filter(shouldIncludeAlert);
          } else {
            // Use filtered cached alerts (already sorted newest first and filtered by listIds and alert type)
            alerts = filteredCachedAlerts;

            // Filter alerts by timestamp if timestamp is provided and count is not
            // Since alerts are sorted newest first, we can use early termination
            if (queryTimestamp && !alertCount) {
              const sinceDate = new Date(queryTimestamp).getTime();
              // Use early termination since alerts are sorted newest first
              // Once we find an alert older than the timestamp, we can stop
              const filteredAlerts = [];
              for (let i = 0; i < alerts.length; i++) {
                const alert = alerts[i];
                if (!alert.alertTimestamp) {
                  continue; // Skip alerts without timestamps
                }
                const alertTime = new Date(alert.alertTimestamp).getTime();
                if (alertTime > sinceDate) {
                  filteredAlerts.push(alert);
                } else {
                  // Alerts are sorted newest first, so we can stop here
                  break;
                }
              }
              alerts = filteredAlerts;
            } else if (alertCount) {
              // Limit to requested count if count was provided
              alerts = alerts.slice(0, alertCount);
            }
          }

          // Use the last backend poll timestamp, or current time if polling hasn't started yet
          const pollingState = getPollingState();
          const lastQueryTimestamp =
            pollingState.lastPollTime || new Date().toISOString();

          cb(null, {
            alerts: alerts,
            count: alerts.length,
            lastQueryTimestamp: lastQueryTimestamp
          });
        } catch (error) {
          const err = parseErrorToReadableJson(error);
          Logger.error(
            { error, formattedError: err, username: username },
            'Failed to get alerts'
          );
          cb({ detail: error.detail || error.message || 'Failed to get alerts', err });
        }
        break;

      case 'getAlertById':
        // Get a single alert by ID from the API
        const { alertId: requestedAlertId } = payload;
        if (!requestedAlertId) {
          return cb({ detail: 'Missing alertId in payload' });
        }
        // Add route prefix to options
        const optionsWithRouteForAlert = { ...options, routePrefix: routePrefix };
        getAlertById(requestedAlertId, optionsWithRouteForAlert)
          .then((alert) => {
            if (alert) {
              Logger.debug(
                { alertId: requestedAlertId },
                'Retrieved alert by ID from API'
              );
              cb(null, { alert });
            } else {
              Logger.warn({ alertId: requestedAlertId }, 'Alert not found in API');
              cb(null, { alert: null, message: 'Alert not found' });
            }
          })
          .catch((error) => {
            const err = parseErrorToReadableJson(error);
            Logger.error(
              { error, formattedError: err, alertId: requestedAlertId },
              'Failed to get alert by ID'
            );
            cb({ detail: error.detail || error.message || 'Failed to get alert by ID', err });
          });
        break;

      case 'renderAlertDetail':
        // Render alert detail HTML using handlebars template
        const { alert: alertToRender, timezone: payloadTimezone } = payload;
        if (!alertToRender) {
          return cb({ detail: 'Missing alert in payload' });
        }

        // Merge timezone from payload into options if provided
        const optionsWithTimezone = payloadTimezone
          ? Object.assign({}, options, { timezone: payloadTimezone })
          : options;

        renderAlertDetail(alertToRender, optionsWithTimezone)
          .then((renderedHtml) => {
            Logger.debug(
              { alertId: alertToRender.alertId },
              'Rendered alert detail template'
            );
            cb(null, { html: renderedHtml });
          })
          .catch((error) => {
            const err = parseErrorToReadableJson(error);
            Logger.error(
              { error, formattedError: err, alertId: alertToRender.alertId },
              'Failed to render alert detail template'
            );
            cb({
              detail: error.message || 'Failed to render alert detail template',
              err
            });
          });
        break;

      case 'renderAlertNotification':
        // Render alert notification HTML using handlebars template
        try {
          const renderedHtml = renderAlertNotification(payload.name);
          Logger.debug('Rendered alert notification template');
          cb(null, { html: renderedHtml });
        } catch (error) {
          const err = parseErrorToReadableJson(error);
          Logger.error(
            { error, formattedError: err },
            'Failed to render alert notification template'
          );
          cb({
            detail: error.message || 'Failed to render alert notification template',
            err
          });
        }
        break;

      case 'getLists':
        // Get lists from Dataminr API
        // Add route prefix to options
        const optionsWithRouteForLists = { ...options, routePrefix: routePrefix };
        getLists(optionsWithRouteForLists)
          .then((lists) => {
            Logger.debug({ listCount: lists.length }, 'Retrieved lists from API');
            cb(null, { lists });
          })
          .catch((error) => {
            // This should never happen since getLists returns empty array on error
            // But keeping for safety
            const err = parseErrorToReadableJson(error);
            Logger.error({ error, formattedError: err }, 'Unexpected error in getLists');
            cb(null, { lists: [] });
          });
        break;

      default:
        Logger.warn({ action }, 'Unknown action in message');
        cb({ detail: `Unknown action: ${action}` });
    }
  } catch (error) {
    const err = parseErrorToReadableJson(error);
    Logger.error({ error, formattedError: err }, 'Message handling failed');
    cb({ detail: error.detail || error.message || 'Message handling failed', err });
  }
};

module.exports = {
  startup,
  shutdown,
  validateOptions,
  doLookup,
  onMessage
};
