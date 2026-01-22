module.exports = {
  LISTS_POLL_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes in milliseconds
  CACHE_MAX_AGE_MS: 30 * 60 * 1000, // 30 minutes in milliseconds
  DEFAULT_PAGE_SIZE: 40, // Default page size for alerts
  STATE_KEY: 'pollingState',
  ALERTS_KEY: 'alerts',
  ALERTS_MAP_KEY: 'alertsMap',
  LISTS_KEY: 'lists',
  ROUTE_PREFIX: 'pulse',
  DEFAULT_ALERT_TYPES_TO_WATCH: ['flash', 'urgent'],
  TRIAL_MODE: true
};