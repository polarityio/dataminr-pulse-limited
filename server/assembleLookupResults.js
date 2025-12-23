const { size, map, some } = require('lodash/fp');
const { getResultForThisEntity } = require('./dataTransformations');
const { MAX_PAGE_SIZE } = require('./constants');
const { processAlertData } = require('./templateRenderer');

/**
 * Assemble lookup results for entities from alerts
 * @param {Array<Object>} entities - Array of entity objects
 * @param {Array<Object>} alerts - Array of alert results from API
 * @param {Object} options - Configuration options
 * @returns {Promise<Array<Object>>} Array of lookup result objects with entity and data properties
 */
const assembleLookupResults = async (entities, alerts, options) => {
  const results = await Promise.all(
    map(async (entity) => {
      const resultsForThisEntity = await getResultsForThisEntity(entity, alerts, options);
      const resultsFound = some(size, resultsForThisEntity);
      const lookupResult = {
        entity,
        data: resultsFound
          ? {
              summary: createSummaryTags(resultsForThisEntity, options),
              details: resultsForThisEntity
            }
          : null
      };

      return lookupResult;
    }, entities)
  );

  return results;
};

/**
 * Get results for a specific entity
 * @param {Object} entity - Entity object to get results for
 * @param {Array<Object>} alerts - Array of alert results
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Object containing alerts array for the entity
 */
const getResultsForThisEntity = async (entity, alerts, options) => {
  const rawAlerts = getResultForThisEntity(entity, alerts);
  // Preprocess alerts for block.hbs template (which doesn't support helpers)
  const processedAlerts = Array.isArray(rawAlerts)
    ? await Promise.all(
        rawAlerts.map(function (alert) {
          return processAlertData(alert, options);
        })
      )
    : [];
  return {
    alerts: processedAlerts
  };
};

/**
 * Create summary tags for lookup results
 * @param {Object} results - Results object containing alerts
 * @param {Array<Object>} results.alerts - Array of alerts
 * @param {Object} options - Configuration options
 * @returns {Array<string>} Array of summary tag strings
 */
const createSummaryTags = ({ alerts }, options) =>
  [].concat(
    size(alerts)
      ? `Alerts: ${size(alerts)}${size(alerts) === MAX_PAGE_SIZE ? '+' : ''}`
      : []
  );

module.exports = assembleLookupResults;
