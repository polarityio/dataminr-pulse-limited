const {
  logging: { getLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { getAlerts } = require('./getAlerts');
const { getPollingState, updatePollingState } = require('./stateManager');
const { processAlerts } = require('./alertProcessor');
const { MAX_PAGE_SIZE } = require('../constants');

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Poll the API for new alerts and process them
 * Uses timestamp-based filtering to get all alerts since last poll.
 * For first poll, fetches MAX_PAGE_SIZE (10) alerts. For subsequent polls, fetches all alerts
 * since lastPollTime by paginating through all pages.
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Resolves with polling result object
 * @returns {boolean} returns.success - Whether polling was successful
 * @returns {number} returns.alertsProcessed - Number of alerts processed
 * @returns {boolean} returns.hasMore - Whether there are more alerts to fetch
 * @returns {string} [returns.error] - Error message if polling failed
 */
const pollAlerts = async (options) => {
  const Logger = getLogger();

  try {
    Logger.debug('Starting Dataminr API poll');

    const state = getPollingState();
    const isFirstPoll = !state.lastPollTime;
    
    let totalAlertsProcessed = 0;
    let paginationCursor = null;
    let hasMore = false;
    let pageCount = 0;
    const lastPollTimestamp = state.lastPollTime;

    // First poll: get 10 alerts to start
    // Subsequent polls: get all alerts since lastPollTime by paginating through all pages
    let totalAlertsFetched = 0; // Track total alerts fetched from API (before filtering)
    
    if (isFirstPoll) {
      Logger.debug('First poll: fetching 10 alerts');
      pageCount = 1; // First poll is always 1 page
      const { alerts, nextPage, rawAlertCount } = await getAlerts(options, null, 10, null);
      totalAlertsFetched = rawAlertCount || 10; // First poll fetches up to 10 alerts
      
      if (alerts.length > 0) {
        await processAlerts(alerts, options);
        totalAlertsProcessed = alerts.length;
      }
      
      hasMore = !!nextPage;
    } else {
      // Subsequent polls: fetch all alerts since lastPollTime
      // Since Dataminr returns alerts newest first, we paginate until we've gotten everything
      // We stop when a page returns 0 alerts after timestamp filtering (all alerts are older)
      Logger.debug(
        { lastPollTime: lastPollTimestamp },
        'Subsequent poll: fetching all alerts since last poll time'
      );

      let continuePaging = true;
      pageCount = 0; // Reset page count for subsequent polls
      totalAlertsFetched = 0; // Reset for subsequent polls
      const maxPages = 50; // Limit to 50 pages (500 alerts) per polling period to avoid rate limiting

      while (continuePaging && pageCount < maxPages) {
        pageCount++;
        
        // Fetch a page of alerts (getAlerts will filter by timestamp client-side)
        const { alerts, nextPage, rawAlertCount } = await getAlerts(
          options,
          paginationCursor,
          null, // No count limit - use timestamp filtering
          lastPollTimestamp
        );

        // Track total alerts fetched from API (before filtering)
        totalAlertsFetched += rawAlertCount || 0;

        // Process alerts from this page
        if (alerts.length > 0) {
          await processAlerts(alerts, options);
          totalAlertsProcessed += alerts.length;
        }

        // Extract cursor from nextPage URL for next iteration
        // nextPage format: /v1/alerts?lists=12345&from=2wVWwq3bBSqy%2FtkFROaX2wUysoSh&pageSize=10
        paginationCursor = null;
        if (nextPage) {
          try {
            const urlParts = nextPage.split('?');
            if (urlParts.length > 1) {
              const urlParams = new URLSearchParams(urlParts[1]);
              paginationCursor = urlParams.get('from');
            }
          } catch (error) {
            Logger.warn({ error, nextPage }, 'Failed to parse nextPage URL for cursor');
          }
        }

        // Continue paging if:
        // 1. There's a nextPage AND
        // 2. We got a full page of alerts (10) after filtering
        // Stop if we got fewer than 10 alerts - this means we've hit alerts older than lastPollTime
        // Since alerts are sorted newest first, if a page has fewer than 10 matching alerts,
        // all subsequent pages will also be older
        continuePaging = !!nextPage && alerts.length === MAX_PAGE_SIZE;
        
        Logger.debug(
          {
            page: pageCount,
            alertsThisPage: alerts.length,
            totalAlertsProcessed,
            hasNextPage: !!nextPage,
            continuePaging
          },
          'Processed page of alerts'
        );

        // Add a small delay between page requests to avoid rate limiting
        // Only delay if we're continuing to the next page
        if (continuePaging) {
          await sleep(200); // 200ms delay between pages
        }
      }

      if (pageCount >= maxPages) {
        Logger.warn(
          { pageCount, totalAlertsProcessed },
          'Reached max pages limit during polling - there may be more alerts'
        );
      }

      hasMore = continuePaging;
    }

    // Update polling state with current timestamp
    updatePollingState({
      lastPollTime: new Date().toISOString(),
      alertCount: totalAlertsProcessed,
      totalAlertsProcessed: state.totalAlertsProcessed + totalAlertsProcessed
    });

    Logger.debug(
      {
        isFirstPoll,
        pageCount,
        totalAlertsFetched,
        totalAlertsProcessed,
        totalProcessed: state.totalAlertsProcessed + totalAlertsProcessed,
        hasMore
      },
      'Polling cycle completed'
    );

    return {
      success: true,
      alertsProcessed: totalAlertsProcessed,
      hasMore: hasMore
    };
  } catch (error) {
    const err = parseErrorToReadableJson(error);
    Logger.error(
      {
        formattedError: err,
        error
      },
      'Polling Dataminr API Failed'
    );

    // Don't throw - allow polling to continue on next interval
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = pollAlerts;
