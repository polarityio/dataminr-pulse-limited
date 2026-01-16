const { getLogger } = require('polarity-integration-utils').logging;
const { requestWithDefaults } = require('../request');
const { ROUTE_PREFIX } = require('../constants');
const { setCachedLists } = require('./stateManager');

/**
 * Get lists from Dataminr API
 * @param {Object} options - Configuration options
 * @returns {Promise<Array>} Resolves with array of lists with value and display properties
 */
const pollLists = async (options) => {
  const Logger = getLogger();

  try {
    Logger.debug('Fetching lists from Dataminr API');

    const route = `${ROUTE_PREFIX}/v1/lists`;
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

    // Save to cache if lists are not null/empty
    if (formattedLists && formattedLists.length > 0) {
      setCachedLists(formattedLists);
      Logger.debug('Lists saved to cache');
    }

    return formattedLists;
  } catch (error) {
    Logger.error(
      { error },
      'Failed to fetch lists from Dataminr API, returning empty array'
    );
    return [];
  }
};

/**
 * Normalize list IDs from user options
 * @param {Array<Object>} setListsToWatch - Array of list objects from user options
 * @returns {Array<string>} Normalized array of list IDs
 */
const parseListConfig = (setListsToWatch) => {
  let normalizedListIds = null;
  if (setListsToWatch && Array.isArray(setListsToWatch) && setListsToWatch.length > 0) {
    // Extract listIds from user options
    normalizedListIds = setListsToWatch
      .map((list) => list.value)
      .filter((id) => id && id !== '0');
    // If listIds is empty after filtering, set to null (no filtering)
    if (normalizedListIds.length === 0) {
      normalizedListIds = null;
    }
  }
  return normalizedListIds;
};

module.exports = {
  pollLists,
  parseListConfig
};
