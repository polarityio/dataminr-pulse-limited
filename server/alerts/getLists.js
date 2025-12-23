const { getLogger } = require('polarity-integration-utils').logging;
const { requestWithDefaults } = require('../request');

/**
 * Get lists from Dataminr API
 * @param {Object} options - Configuration options
 * @param {string} options.routePrefix - Route prefix for the API (e.g., 'firstalert' or 'pulse')
 * @returns {Promise<Array>} Resolves with array of lists with value and display properties
 */
const getLists = async (options) => {
  const Logger = getLogger();

  try {
    // Validate required options
    if (!options || !options.routePrefix) {
      Logger.warn({ options }, 'Missing routePrefix option, returning empty list');
      return [];
    }

    Logger.debug('Fetching lists from Dataminr API');

    const route = `${options.routePrefix}/v1/lists`;
    const response = await requestWithDefaults({
      route,
      options,
      method: 'GET'
    });

    // The response structure is: { lists: { TOPIC: [...], COMPANY: [...] } }
    const listsObject = (response.body && response.body.lists) || {};

    // Flatten all lists from all types into a single array
    const allLists = [];
    Object.keys(listsObject).forEach((listType) => {
      const listsOfType = listsObject[listType] || [];
      allLists.push(...listsOfType);
    });

    // Transform lists to format expected by select options: { value, display }

    const formattedLists = allLists.map((list) => {
      return {
        value: String(list.id || ''),
        display: list.name || ''
      };
    });

    Logger.debug({ listCount: formattedLists.length }, 'Retrieved lists from API');

    return formattedLists;
  } catch (error) {
    Logger.error({ error, routePrefix: options?.routePrefix }, 'Failed to fetch lists from Dataminr API, returning empty array');
    return [];
  }
};

module.exports = {
  getLists
};
