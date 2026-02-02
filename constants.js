module.exports = {
  LISTS_POLL_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes in milliseconds
  CACHE_MAX_AGE_MS: 72 * 60 * 60 * 1000, // 72 hours in milliseconds
  CACHE_MAX_ITEMS: 100, // When cache exceeds this, oldest items are evicted (FIFO)
  DEFAULT_PAGE_SIZE: 40, // Default page size for alerts
  STATE_KEY: 'pollingState',
  ALERTS_KEY: 'alerts',
  ALERTS_MAP_KEY: 'alertsMap',
  LISTS_KEY: 'lists',
  ROUTE_PREFIX: 'pulse',
  DEFAULT_ALERT_TYPES_TO_WATCH: ['flash', 'urgent'],
  TRIAL_MODE: true,
  POLL_INTERVAL_MS: 360 * 1000, // 6 minutes in milliseconds
  CAL_API_URL: 'https://helix-dev.threatconnect.com/helix/publications/v1/download?since=0&owner=70001'
};