const {
  logging: { getLogger }
} = require('polarity-integration-utils');
const {
  STATE_KEY,
  ALERTS_KEY,
  LISTS_KEY,
  ALERTS_MAP_KEY,
  CACHE_MAX_AGE_MS,
  CACHE_MAX_ITEMS,
  DEFAULT_ALERT_TYPES_TO_WATCH
} = require('../../constants');

// Native in-memory cache stores
const cache = {
  [STATE_KEY]: null,
  [ALERTS_KEY]: [],
  [LISTS_KEY]: [],
  [ALERTS_MAP_KEY]: new Map()
};

/**
 * Get the current polling state
 * @returns {Object} Polling state object
 * @returns {string|null} returns.lastCursor - Last pagination cursor used
 * @returns {number|null} returns.lastPollTime - epoch milliseconds timestamp of last poll
 * @returns {number} returns.alertCount - Number of alerts in last poll
 * @returns {number} returns.totalAlertsProcessed - Total alerts processed since reset
 * @returns {number} returns.lastSince - Max zip entry number from last poll (used as `since` on next request)
 */
const getPollingState = () => {
  return (
    cache[STATE_KEY] || {
      lastCursor: null,
      lastPollTime: null,
      alertCount: 0,
      totalAlertsProcessed: 0,
      lastSince: 0
    }
  );
};

/**
 * Update the polling state with new values
 * @param {Object} updates - Partial state object to merge with current state
 * @param {string} [updates.lastCursor] - New pagination cursor
 * @param {number} [updates.lastPollTime] - epoch milliseconds timestamp of last poll
 * @param {number} [updates.alertCount] - Number of alerts in current poll
 * @param {number} [updates.totalAlertsProcessed] - Total alerts processed
 * @param {number} [updates.lastSince] - Max zip entry number for next `since` query param
 * @returns {Object} Updated polling state object
 */
const updatePollingState = (updates) => {
  const currentState = getPollingState();
  const newState = {
    ...currentState,
    ...updates
  };
  cache[STATE_KEY] = newState;
  return newState;
};

/**
 * Reset the polling state to initial values
 * @returns {void}
 */
const resetPollingState = () => {
  cache[STATE_KEY] = null;
};

/**
 * Get all cached alerts (does not mutate the cache)
 * @param {string|null} alertFilterTimestamp - Optional ISO timestamp to filter returned alerts (returns alerts after this timestamp)
 * @returns {Array<Object>} Array of alert objects (sorted newest first)
 */
const getCachedAlerts = (alertFilterTimestamp = null) => {
  const alerts = cache[ALERTS_KEY] || [];

  if (alerts.length === 0) {
    return [];
  }

  if (!alertFilterTimestamp) {
    return alerts;
  }

  const filterTimestampMs = new Date(alertFilterTimestamp).getTime();
  return alerts.filter((alert) => {
    if (!alert.alertTimestamp) return false;
    return new Date(alert.alertTimestamp).getTime() > filterTimestampMs;
  });
};

/** Normalized set of alert type names to cache (lowercase) */
const getAlertTypesToWatchSet = () => {
  const types = DEFAULT_ALERT_TYPES_TO_WATCH || [];
  return new Set(
    types.map((t) =>
      t && typeof t === 'object' && t.value
        ? String(t.value).toLowerCase()
        : String(t).toLowerCase()
    )
  );
};

/**
 * Add alerts to the global cache
 * Alerts are kept sorted by timestamp (newest first) for efficient timestamp lookups
 * Also maintains a Map for O(1) lookups by alertId
 * Only alerts whose type is in DEFAULT_ALERT_TYPES_TO_WATCH are added.
 * @param {Array<Object>} alerts - Array of alert objects to add (should be sorted newest first)
 * @returns {Object} Result object
 * @returns {number} returns.added - Number of new alerts added
 * @returns {number} returns.total - Total alerts in cache after adding
 */
const addAlertsToCache = (alerts) => {
  const Logger = getLogger();
  if (!alerts || alerts.length === 0) {
    return { added: 0, total: cache[ALERTS_KEY]?.length || 0 };
  }

  const alertTypesSet = getAlertTypesToWatchSet();
  const allowedAlerts =
    alertTypesSet.size === 0
      ? alerts
      : alerts.filter((alert) => {
          const name =
            alert.alertType && alert.alertType.name
              ? alert.alertType.name.toLowerCase()
              : 'alert';
          return alertTypesSet.has(name);
        });

  if (allowedAlerts.length === 0) {
    return { added: 0, total: cache[ALERTS_KEY]?.length || 0 };
  }

  const existingAlerts = cache[ALERTS_KEY] || [];
  const existingMap = cache[ALERTS_MAP_KEY] || new Map();

  // Filter out duplicates from incoming alerts using existing map
  const now = Date.now();
  const cutoffTime = now - CACHE_MAX_AGE_MS;
  const newAlertsToAdd = [];

  allowedAlerts.forEach((alert) => {
    if (!alert.alertId) {
      // No ID - add it but it won't be in map
      newAlertsToAdd.push(alert);
      return;
    }

    // Skip if already exists
    if (existingMap.has(alert.alertId)) {
      return;
    }

    // Skip if too old (no point adding it)
    const alertTime = alert.alertTimestamp
      ? new Date(alert.alertTimestamp).getTime()
      : now;
    if (alertTime <= cutoffTime) {
      return;
    }

    newAlertsToAdd.push(alert);
    existingMap.set(alert.alertId, alert); // Add to map immediately
  });

  if (newAlertsToAdd.length === 0) {
    return { added: 0, total: existingAlerts.length };
  }

  // Merge new alerts with existing (new alerts should be newer, so prepend)
  const allAlerts = [...newAlertsToAdd, ...existingAlerts];

  // FIFO when over limit: keep only the newest CACHE_MAX_ITEMS (evict oldest first)
  let filteredAlerts = allAlerts;
  if (allAlerts.length > CACHE_MAX_ITEMS) {
    const sorted = [...allAlerts].sort((a, b) => {
      const timeA = a.alertTimestamp ? new Date(a.alertTimestamp).getTime() : 0;
      const timeB = b.alertTimestamp ? new Date(b.alertTimestamp).getTime() : 0;
      return timeB - timeA;
    });
    filteredAlerts = sorted.slice(0, CACHE_MAX_ITEMS);
  } else if (allAlerts.length > 10) {
    // Under limit but check order (newest first)
    let needsSort = false;
    for (let i = 1; i < Math.min(10, allAlerts.length); i++) {
      const timeA = new Date(allAlerts[i - 1].alertTimestamp || 0).getTime();
      const timeB = new Date(allAlerts[i].alertTimestamp || 0).getTime();
      if (timeA < timeB) {
        needsSort = true;
        break;
      }
    }
    if (needsSort) {
      filteredAlerts = [...allAlerts].sort((a, b) => {
        const timeA = a.alertTimestamp ? new Date(a.alertTimestamp).getTime() : 0;
        const timeB = b.alertTimestamp ? new Date(b.alertTimestamp).getTime() : 0;
        return timeB - timeA;
      });
    }
  }

  // Rebuild map from scratch only if we evicted (FIFO trim)
  if (filteredAlerts.length !== allAlerts.length) {
    existingMap.clear();
    filteredAlerts.forEach((alert) => {
      if (alert.alertId) {
        existingMap.set(alert.alertId, alert);
      }
    });
  }

  // Update caches
  cache[ALERTS_KEY] = filteredAlerts;
  cache[ALERTS_MAP_KEY] = existingMap;

  return {
    added: newAlertsToAdd.length,
    total: filteredAlerts.length
  };
};

/**
 * Clear all cached alerts
 * @returns {void}
 */
const clearCachedAlerts = () => {
  cache[ALERTS_KEY] = [];
  cache[ALERTS_MAP_KEY] = new Map();
};

/**
 * Get a single alert by ID from the cache (O(1) lookup)
 * No age filtering - if we're asking for a specific alert, return it if it exists
 * @param {string} alertId - Alert ID to look up
 * @returns {Object|null} Alert object or null if not found
 */
const getCachedAlertById = (alertId) => {
  if (!alertId) return null;

  const alertsMap = cache[ALERTS_MAP_KEY];
  if (!alertsMap) return null;

  return alertsMap.get(alertId) || null;
};

/**
 * Get the timestamp of the latest alert in the cache
 * @returns {string|null} ISO timestamp of the latest alert, or null if no alerts
 */
const getLatestAlertTimestamp = () => {
  const alerts = cache[ALERTS_KEY] || [];
  if (alerts.length > 0 && alerts[0].alertTimestamp) {
    const timestamp = alerts[0].alertTimestamp;
    // Ensure it's a valid ISO timestamp string
    try {
      return new Date(timestamp).toISOString();
    } catch (error) {
      return timestamp;
    }
  }
  return null;
};

/**
 * Get cached lists
 * @returns {Array<Object>} Array of list objects with value and display properties
 */
const getCachedLists = () => {
  return cache[LISTS_KEY] || [];
};

/**
 * Set cached lists
 * @param {Array<Object>} lists - Array of list objects with value and display properties
 * @returns {void}
 */
const setCachedLists = (lists) => {
  if (lists && Array.isArray(lists) && lists.length > 0) {
    cache[LISTS_KEY] = lists;
  }
};

module.exports = {
  getPollingState,
  updatePollingState,
  resetPollingState,
  getCachedAlerts,
  getCachedAlertById,
  addAlertsToCache,
  clearCachedAlerts,
  getLatestAlertTimestamp,
  getCachedLists,
  setCachedLists
};
