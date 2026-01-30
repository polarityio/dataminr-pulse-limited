const {
  logging: { getLogger }
} = require('polarity-integration-utils');
const AdmZip = require('adm-zip');

const { requestWithDefaults } = require('../request');
const { getCachedAlertById } = require('./stateManager');

/**
 * Parse numeric part from zip entry name (e.g. "301.json" -> 301, "302.jsonl" -> 302).
 * @param {string} entryName - Zip entry name
 * @returns {number|null} Parsed number or null if not a numeric filename
 */
const parseEntryNumber = (entryName) => {
  const match = entryName.match(/^(\d+)\.(jsonl?)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
};

/**
 * Extract alerts from all JSON/JSONL files in zip buffer (in-memory).
 * Zip may contain multiple JSON files; each is parsed and alerts are combined.
 * Also computes max numeric filename for use as `since` on the next poll.
 * @param {Buffer} zipBuffer - Raw zip file buffer from API
 * @returns {{ alerts: Array<Object>, maxSince: number }} Combined alerts and max entry number
 */
const extractAlertsFromZipBuffer = (zipBuffer) => {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const jsonEntries = entries.filter(
    (e) => !e.isDirectory && (e.entryName.endsWith('.json') || e.entryName.endsWith('.jsonl'))
  );
  if (jsonEntries.length === 0) {
    throw new Error('No JSON file found in zip');
  }
  const allAlerts = [];
  let maxSince = 0;
  for (const entry of jsonEntries) {
    const num = parseEntryNumber(entry.entryName);
    if (num !== null && num > maxSince) maxSince = num;
    const data = entry.getData();
    const parsed = JSON.parse(data.toString('utf8'));
    const alerts = Array.isArray(parsed) ? parsed : (parsed.alerts || []);
    allAlerts.push(...alerts);
  }
  return { alerts: allAlerts, maxSince };
};

/**
 * Get alerts from the API (proxy returns a zip; we extract and parse as JSON).
 * No pagination - single zip payload with alerts.
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Resolves with object containing alerts array
 */
const getAlerts = async (options) => {
  const Logger = getLogger();

  try {
    const response = await requestWithDefaults({
      options,
      method: 'GET'
    });

    const zipBuffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
    const { alerts, maxSince } = extractAlertsFromZipBuffer(zipBuffer);

    Logger.debug(
      { alertCount: alerts.length, maxSince, statusCode: response.statusCode },
      'Dataminr API response received (from zip)'
    );

    return {
      alerts,
      maxSince
    };
  } catch (error) {
    const statusCode = error.statusCode || (error.meta && error.meta.statusCode);
    const message = error.message || error.detail || 'Unknown error';
    Logger.error(
      { statusCode, message: message, detail: error.detail },
      'Getting Alerts Failed'
    );
    throw error;
  }
};

/**
 * Get a single alert by ID from the API
 * @param {string} alertId - Alert ID to fetch
 * @returns {Promise<Object>} Resolves with alert object
 */
const getAlertById = async (alertId) => {
  const Logger = getLogger();

  if (!alertId) {
    throw new Error('Alert ID is required');
  }

  // Check cache first (no age filtering for direct lookups)
  const cachedAlert = getCachedAlertById(alertId);

  if (cachedAlert) {
    Logger.debug({ alertId }, 'Alert found in cache lookup)');
    return cachedAlert;
  }
  return null;
};

module.exports = {
  getAlerts,
  getAlertById
};
