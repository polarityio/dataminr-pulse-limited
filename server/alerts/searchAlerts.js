const { map } = require('lodash/fp');

const {
  logging: { getLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { requestsInParallel } = require('../request');
const { MAX_PAGE_SIZE } = require('../constants');

/**
 * Search for alerts matching the given entities
 * @param {Array<Object>} entities - Array of entity objects to search for
 * @param {Object} options - Configuration options
 * @param {string} options.routePrefix - Route prefix for the API (e.g., 'firstalert' or 'pulse')
 * @returns {Promise<Array<Object>>} Resolves with array of alert results
 */
const searchAlerts = async (entities, options) => {
  const Logger = getLogger();

  try {
    const route = `${options.routePrefix}/v1/alerts`;
    const alertsRequests = map(
      (entity) => ({
        resultId: entity.value,
        route,
        qs: {
          query: entity.value,
          pageSize: MAX_PAGE_SIZE
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
