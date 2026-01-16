const { map } = require('lodash/fp');

const {
  logging: { getLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { requestsInParallel } = require('../request');
const { DEFAULT_PAGE_SIZE, ROUTE_PREFIX } = require('../constants');

/**
 * Search for alerts matching the given entities against all Lists
 * @param {Array<Object>} entities - Array of entity objects to search for
 * @param {Object} options - Configuration options
 * @returns {Promise<Array<Object>>} Resolves with array of alert results
 * @returns {Array<Object>} returns.alerts - Array of alert objects
 */
const searchAlerts = async (entities, options) => {
  const Logger = getLogger();

  try {
    const route = `${ROUTE_PREFIX}/v1/alerts`;
    const alertsRequests = map(
      (entity) => ({
        resultId: entity.value,
        route,
        qs: {
          query: entity.value,
          pageSize: DEFAULT_PAGE_SIZE
        },
        options
      }),
      entities
    );

    const alerts = await requestsInParallel(alertsRequests, 'body.alerts');

    return alerts;
  } catch (error) {
    const err = parseErrorToReadableJson(error);
    Logger.error(
      {
        formattedError: err,
        error
      },
      'Searching Dataminr Alerts Failed'
    );
    throw error;
  }
};

module.exports = searchAlerts;
