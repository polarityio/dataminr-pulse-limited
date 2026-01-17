const NodeCache = require('node-cache');
const { STATE_KEY, ALERTS_KEY, LISTS_KEY, CACHE_MAX_AGE_MS } = require('../../constants');

// Cache for storing polling state
// Key: 'pollingState', Value: { lastCursor, lastPollTime, alertCount }
const stateCache = new NodeCache({ stdTTL: 0 }); // No expiration

// Global cache for storing all polled alerts (sorted by timestamp, newest first)
// Key: 'alerts', Value: Array of alert objects
const alertsCache = new NodeCache({ stdTTL: 0 }); // No expiration

// Global cache for storing lists
// Key: 'lists', Value: Array of list objects with value and display properties
const listsCache = new NodeCache({ stdTTL: 0 }); // No expiration

/**
 * Get the current polling state
 * @returns {Object} Polling state object
 * @returns {string|null} returns.lastCursor - Last pagination cursor used
 * @returns {number|null} returns.lastPollTime - epoch milliseconds timestamp of last poll
 * @returns {number} returns.alertCount - Number of alerts in last poll
 * @returns {number} returns.totalAlertsProcessed - Total alerts processed since reset
 */
const getPollingState = () => {
  return (
    stateCache.get(STATE_KEY) || {
      lastCursor: null,
      lastPollTime: null,
      alertCount: 0,
      totalAlertsProcessed: 0
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
 * @returns {Object} Updated polling state object
 */
const updatePollingState = (updates) => {
  const currentState = getPollingState();
  const newState = {
    ...currentState,
    ...updates
  };
  stateCache.set(STATE_KEY, newState);
  return newState;
};

/**
 * Reset the polling state to initial values
 * @returns {void}
 */
const resetPollingState = () => {
  stateCache.del(STATE_KEY);
};

/**
 * Filter alerts to remove those older than the max cache age
 * Optionally also filter by alertFilterTimestamp if provided
 * @param {Array<Object>} alerts - Array of alert objects
 * @param {string|null} alertFilterTimestamp - Optional ISO timestamp to filter alerts (returns alerts after this timestamp)
 * @returns {Array<Object>} Filtered array of alerts (only those within max age and after alertFilterTimestamp if provided)
 */
const filterAlertsByAge = (alerts, alertFilterTimestamp = null) => {
  const now = Date.now();
  const maxAge = CACHE_MAX_AGE_MS;

  // Convert alertFilterTimestamp to milliseconds if provided
  const filterTimestamp = alertFilterTimestamp
    ? new Date(alertFilterTimestamp).getTime()
    : null;

  return alerts.filter((alert) => {
    if (!alert.alertTimestamp) {
      return false; // Remove alerts without timestamps
    }
    const alertTime = new Date(alert.alertTimestamp).getTime();
    const age = now - alertTime;

    // Must be within max age
    if (age > maxAge) {
      return false;
    }

    // If alertFilterTimestamp is provided, alert must be newer than it
    if (filterTimestamp !== null && alertTime <= filterTimestamp) {
      return false;
    }

    return true;
  });
};

/**
 * Get all cached alerts (filtered to remove alerts older than 1 hour)
 * @param {Array<string>} [listIds] - Optional array of list IDs to filter by. If provided, only returns alerts that match any of the list IDs.
 * @returns {Array<Object>} Array of alert objects (sorted newest first)
 */
const getCachedAlerts = (listIds = null, alertFilterTimestamp = null) => {
  const alerts = alertsCache.get(ALERTS_KEY) || [];
  let filteredAlerts = filterAlertsByAge(alerts, alertFilterTimestamp);

  // Filter by listIds if provided (this is a user-specific filter, doesn't affect cache)
  if (listIds && listIds.length > 0) {
    filteredAlerts = filteredAlerts.filter((alert) => {
      // Check if alert has listsMatched and if any match the requested listIds
      if (!alert.listsMatched || !Array.isArray(alert.listsMatched)) {
        return false;
      }
      // Check if any of the alert's matched list IDs are in the requested listIds
      return alert.listsMatched.some((matchedList) => {
        if (!matchedList || !matchedList.id) {
          return false;
        }
        const matchedListId = String(matchedList.id).trim();
        return listIds.includes(matchedListId);
      });
    });
  }

  return filteredAlerts;
};

/**
 * Add alerts to the global cache
 * Alerts are kept sorted by timestamp (newest first) for efficient timestamp lookups
 * @param {Array<Object>} alerts - Array of alert objects to add (should be sorted newest first)
 * @returns {Object} Result object
 * @returns {number} returns.added - Number of new alerts added
 * @returns {number} returns.total - Total alerts in cache after adding
 */
const addAlertsToCache = (alerts) => {
  const existingAlerts = getCachedAlerts();

  // Merge alerts while maintaining sort order (newest first)
  // New alerts from API are already sorted newest first, so prepend them
  const allAlerts = [...alerts, ...existingAlerts];

  // Sort by timestamp (newest first) to ensure correct order
  // This handles edge cases where alerts might not be perfectly sorted
  allAlerts.sort((a, b) => {
    const timeA = a.alertTimestamp ? new Date(a.alertTimestamp).getTime() : 0;
    const timeB = b.alertTimestamp ? new Date(b.alertTimestamp).getTime() : 0;
    return timeB - timeA; // Descending order (newest first)
  });

  // Remove duplicates based on alertId
  const seenIds = new Set();
  const deduplicatedAlerts = allAlerts.filter((alert) => {
    if (!alert.alertId) {
      return true; // Keep alerts without IDs
    }
    if (seenIds.has(alert.alertId)) {
      return false;
    }
    seenIds.add(alert.alertId);
    return true;
  });

  // Filter out alerts older than 1 hour
  const filteredAlerts = filterAlertsByAge(deduplicatedAlerts);

  // Update cache with filtered alerts
  alertsCache.set(ALERTS_KEY, filteredAlerts);

  return {
    added: alerts.length,
    total: filteredAlerts.length
  };
};

/**
 * Clear all cached alerts
 * @returns {void}
 */
const clearCachedAlerts = () => {
  alertsCache.set(ALERTS_KEY, []);
};

/**
 * Get the timestamp of the latest alert in the cache
 * @returns {string|null} ISO timestamp of the latest alert, or null if no alerts
 */
const getLatestAlertTimestamp = () => {
  const alerts = alertsCache.get(ALERTS_KEY) || [];
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
  return listsCache.get(LISTS_KEY) || [];
};

/**
 * Set cached lists
 * @param {Array<Object>} lists - Array of list objects with value and display properties
 * @returns {void}
 */
const setCachedLists = (lists) => {
  if (lists && Array.isArray(lists) && lists.length > 0) {
    listsCache.set(LISTS_KEY, lists);
  }
};

module.exports = {
  getPollingState,
  updatePollingState,
  resetPollingState,
  getCachedAlerts,
  addAlertsToCache,
  clearCachedAlerts,
  getLatestAlertTimestamp,
  getCachedLists,
  setCachedLists
};
