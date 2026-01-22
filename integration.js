const {
  logging: { setLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { validateOptions } = require('./server/userOptions');
const { removePrivateIps } = require('./server/dataTransformations');
const {
  pollAlerts,
  pollLists,
  resetPollingState,
  searchAlerts,
  getAlertById,
  parseListConfig
} = require('./server/alerts');
const {
  getCachedAlerts,
  getLatestAlertTimestamp,
  getCachedLists,
  addAlertsToCache
} = require('./server/alerts/stateManager');
const { getAlerts } = require('./server/alerts/getAlerts');
const { setLogger: setRequestLogger } = require('./server/request');
const {
  renderAlertDetail,
  renderAlertNotification
} = require('./server/templateRenderer');

const assembleLookupResults = require('./server/assembleLookupResults');
const {
  DEFAULT_ALERT_TYPES_TO_WATCH,
  TRIAL_MODE,
  LISTS_POLL_INTERVAL_MS
} = require('./constants');

let Logger = null;
let alertPollingInterval = null;
let listsPollingInterval = null;
let pollingInitialized = false;

// Cache for alert type filters (per user configuration)
const alertTypeFilterCache = new Map();

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
  pollAlerts(options);
  pollLists(options);

  // Set up polling interval for alerts - admin configurable
  const alertPollIntervalMs = options.pollInterval * 1000; // Convert seconds to milliseconds

  alertPollingInterval = setInterval(async () => {
    try {
      pollAlerts(options);
    } catch (error) {
      Logger.error({ error }, 'Error in polling interval');
    }
  }, alertPollIntervalMs);

  listsPollingInterval = setInterval(async () => {
    try {
      pollLists(options);
    } catch (error) {
      Logger.error({ error }, 'Error in lists polling interval');
    }
  }, LISTS_POLL_INTERVAL_MS);

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
    const alerts = await searchAlerts(searchableEntities, options);

    // Cache all alerts from search results for future lookups
    const allAlerts = [];
    if (alerts && Array.isArray(alerts)) {
      alerts.forEach((alertResult) => {
        if (alertResult && alertResult.result && Array.isArray(alertResult.result)) {
          allAlerts.push(...alertResult.result);
        }
      });
      if (allAlerts.length > 0) {
        addAlertsToCache(allAlerts);
        Logger.debug(
          { alertCount: allAlerts.length },
          'Cached alerts from search results'
        );
      }
    }

    Logger.trace({ alerts, searchableEntities });

    let lookupResults;
    if (!TRIAL_MODE) {
      lookupResults = await assembleLookupResults(entities, alerts, options);
    } else {
      // For trial version: return count with trial message instead of real results
      lookupResults = entities.map((entity) => {
        // Find alerts for this entity (alerts structure: [{resultId, result: [...]}, ...])
        const entityResult = alerts.find(
          (alertResult) => alertResult.resultId === entity.value
        );
        const alertCount =
          entityResult && Array.isArray(entityResult.result)
            ? entityResult.result.length
            : 0;

        return {
          entity,
          data:
            alertCount > 0
              ? {
                  summary: [`Alerts: ${alertCount}`],
                  details: {
                    trialSearch: true,
                    alertCount: alertCount,
                    alerts: [] // Empty array - no real results for trial
                  }
                }
              : null
        };
      });
    }

    Logger.trace({ lookupResults }, 'Lookup Results');

    cb(null, lookupResults);
  } catch (error) {
    const err = parseErrorToReadableJson(error);

    Logger.error({ error, formattedError: err }, 'Get Lookup Results Failed');
    cb({ detail: error?.detail || error?.message || 'Lookup Failed', err });
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
  if (alertPollingInterval) {
    clearInterval(alertPollingInterval);
    alertPollingInterval = null;
  }
  if (listsPollingInterval) {
    clearInterval(listsPollingInterval);
    listsPollingInterval = null;
  }
  if (pollingInitialized) {
    pollingInitialized = false;
    Logger.info('Polling stopped');
  }
};

/**
 * Create a filter function for alert types based on configuration
 * @param {Object} options - Configuration options
 * @returns {Function} Filter function that returns true if alert should be included
 */
const createAlertTypeFilter = (options) => {
  // Create cache key from alert types configuration
  const alertTypesToWatch =
    options.setAlertTypesToWatch && options.setAlertTypesToWatch.length > 0
      ? options.setAlertTypesToWatch
      : DEFAULT_ALERT_TYPES_TO_WATCH;
  
  // Create stable cache key (JSON string of sorted array)
  const cacheKey = JSON.stringify(
    alertTypesToWatch.map(t => (t && typeof t === 'object' && t.value) ? t.value : t).sort()
  );
  
  // Return cached filter if exists
  if (alertTypeFilterCache.has(cacheKey)) {
    return alertTypeFilterCache.get(cacheKey);
  }

  // Normalize to lowercase for comparison
  // Handle both string arrays and object arrays with {value, display} structure
  const normalizedAlertTypesToWatch = alertTypesToWatch.map((type) => {
    // If it's an object with a value property, use that
    if (type && typeof type === 'object' && type.value) {
      return typeof type.value === 'string'
        ? type.value.toLowerCase()
        : String(type.value).toLowerCase();
    }
    // Otherwise treat as string
    return typeof type === 'string' ? type.toLowerCase() : String(type).toLowerCase();
  });
  
  // Convert to Set for O(1) lookup
  const alertTypesSet = new Set(normalizedAlertTypesToWatch);

  // Return filter function that checks if alert type should be included
  const filterFn = (alert) => {
    if (alertTypesSet.size === 0) {
      return true; // Include all if no filter configured
    }
    const alertTypeName =
      alert.alertType && alert.alertType.name
        ? alert.alertType.name.toLowerCase()
        : 'alert';
    return alertTypesSet.has(alertTypeName);
  };
  
  // Cache the filter function
  alertTypeFilterCache.set(cacheKey, filterFn);
  
  return filterFn;
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
    initializePolling(options);
    const listIds = parseListConfig(options.setListsToWatch);

    const { action } = payload;

    if (!action) {
      return cb({ detail: 'Missing action in payload' });
    }

    const username = options._request.user.username;

    switch (action) {
      case 'getAlerts':
        // Extract parameters from payload
        const { sinceTimestamp, count: countParam } = payload;

        // Use the latest alert timestamp for filtering consistency
        const lastAlertTimestamp = getLatestAlertTimestamp() || new Date().toISOString();

        // Parse count parameter (from URL or payload)
        const alertCount = countParam ? parseInt(countParam, 10) : null;

        // Use provided timestamp or default to current time if not provided
        // If alertCount is provided, don't filter by timestamp (return null)
        const alertFilterTimestamp = alertCount
          ? null
          : sinceTimestamp || new Date().toISOString();

        // Create alert type filter function
        const alertTypeFilter = createAlertTypeFilter(options);

        try {
          // Get alerts from global cache (filtered by listIds if provided)
          const cachedAlerts = getCachedAlerts(listIds, alertFilterTimestamp);
          // Filter cached alerts by alert type
          let alerts = cachedAlerts.filter(alertTypeFilter);

          // Check if we need to query API (only if count is requested and cache doesn't have enough)
          if (alertCount && alerts.length < alertCount) {
            try {
              // Query API for alerts (count overrides timestamp for initial query)
              const { alerts: apiAlerts } = await getAlerts(options, {
                listIds: listIds,
                pageSize: alertCount
              });

              // Cache the fetched alerts for future lookups
              if (apiAlerts && apiAlerts.length > 0) {
                addAlertsToCache(apiAlerts);
                Logger.debug(
                  { alertCount: apiAlerts.length },
                  'Cached alerts from alertCount query'
                );
              }

              // Filter API alerts by alert type
              // Note: Since we currently filter by alert type after getAlerts, we could have less than the requested count
              alerts = apiAlerts.filter(alertTypeFilter);
            } catch (apiError) {
              const errorStatus =
                apiError?.status || apiError?.statusCode || apiError?.meta?.statusCode;
              if (errorStatus === 429 || errorStatus === '429') {
                Logger.warn(
                  { username },
                  'Rate limit encountered, returning cached alerts'
                );
              } else {
                throw apiError;
              }
            }
          }

          if (alertCount) {
            // Limit to requested count if count was provided
            alerts = alerts.slice(0, alertCount);
          }

          cb(null, {
            alerts: alerts,
            count: alerts.length,
            lastAlertTimestamp: lastAlertTimestamp
          });
        } catch (error) {
          const err = parseErrorToReadableJson(error);
          Logger.error(
            { error, formattedError: err, username: username },
            'Failed to get alerts'
          );
          cb({
            detail: error?.detail || error?.message || 'Failed to get alerts',
            ...(error?.status && { status: error.status }),
            ...(err && typeof err === 'object' && !Array.isArray(err) && { err })
          });
        }
        break;

      case 'getAlertById':
        // Get a single alert by ID from the API
        const { alertId: requestedAlertId } = payload;
        if (!requestedAlertId) {
          return cb({ detail: 'Missing alertId in payload' });
        }

        const optionsWithListIds = { ...options, listIds: listIds };
        getAlertById(requestedAlertId, optionsWithListIds)
          .then((alert) => {
            if (alert) {
              // Cache the fetched alert for future lookups
              addAlertsToCache([alert]);
              Logger.debug(
                { alertId: requestedAlertId },
                'Retrieved and cached alert by ID from API'
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
            cb({
              detail: error?.detail || error?.message || 'Failed to get alert by ID',
              err
            });
          });
        break;

      case 'renderAlertDetail':
        // Render alert detail HTML using handlebars template
        // Fetch alert from backend cache (or API if not cached) and render
        const { alertId: renderAlertId, timezone: renderTimezone } = payload;
        if (!renderAlertId) {
          return cb({ detail: 'Missing alertId in payload' });
        }
        const renderOptionsWithListIds = { ...options, listIds: listIds };
        const renderOptionsWithTimezone = renderTimezone
          ? Object.assign({}, renderOptionsWithListIds, { timezone: renderTimezone })
          : renderOptionsWithListIds;

        getAlertById(renderAlertId, renderOptionsWithListIds)
          .then(async (alert) => {
            if (!alert) {
              Logger.warn({ alertId: renderAlertId }, 'Alert not found when rendering detail');
              return cb(null, { html: '' });
            }

            const renderedHtml = await renderAlertDetail(alert, renderOptionsWithTimezone);
            Logger.debug(
              { alertId: renderAlertId },
              'Rendered alert detail template'
            );
            cb(null, { html: renderedHtml });
          })
          .catch((error) => {
            const err = parseErrorToReadableJson(error);
            Logger.error(
              { error, formattedError: err, alertId: renderAlertId },
              'Failed to render alert detail template'
            );
            cb({
              detail: error?.message || 'Failed to render alert detail template',
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
            detail: error?.message || 'Failed to render alert notification template',
            err
          });
        }
        break;

      case 'getLists':
        // Get lists from cache
        const cachedLists = getCachedLists();
        cb(null, { lists: cachedLists || [] });
        break;

      default:
        Logger.warn({ action }, 'Unknown action in message');
        cb({ detail: `Unknown action: ${action}` });
    }
  } catch (error) {
    const err = parseErrorToReadableJson(error);
    Logger.error({ error, formattedError: err }, 'Message handling failed');
    cb({ detail: error?.detail || error?.message || 'Message handling failed', err });
  }
};

module.exports = {
  startup,
  shutdown,
  validateOptions,
  doLookup,
  onMessage
};
