const {
  logging: { getLogger },
  errors: { parseErrorToReadableJson }
} = require('polarity-integration-utils');

const { getAlerts } = require('./getAlerts');
const { getPollingState, updatePollingState } = require('./stateManager');
const { processAlerts } = require('./alertProcessor');
const { DEFAULT_PAGE_SIZE } = require('../constants');

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
 * Uses cursor-based pagination to resume from the last position in the stream.
 * For first poll, fetches DEFAULT_PAGE_SIZE (10) alerts and saves the cursor.
 * For subsequent polls, resumes from the saved cursor and paginates foward until
 * all new alerts are fetched (using timestamp filtering to determine when to stop).
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
    // For subsequent polls, start with the saved cursor from last poll
    // This allows us to resume from where we left off in the stream
    let lastCursor = isFirstPoll ? null : state.lastCursor || null;
    let hasMore = false;
    let pageCount = 0;

    // First poll: get 10 alerts to start
    // Subsequent polls: get all alerts since last alert timestamp by paginating through all pages
    let totalAlertsFetched = 0; // Track total alerts fetched from API (before filtering)

    if (isFirstPoll) {
      Logger.debug('First poll: fetching 10 alerts');
      pageCount = 1; // First poll is always 1 page
      const { alerts, nextPageCursor } = await getAlerts(options, { pageSize: 10 });
      totalAlertsFetched = alerts.length; // First poll fetches up to 10 alerts

      if (alerts.length > 0) {
        processAlerts(alerts, options);
        totalAlertsProcessed = alerts.length;
      }

      // Save the cursor from nextPageCursor for the next poll
      // This allows us to resume from where we left off
      lastCursor = nextPageCursor ? nextPageCursor : lastCursor;
      hasMore = false;
    } else {
      // Subsequent polls: resume from saved cursor position in the stream
      // We use the cursor from the last poll to continue forward in time

      let continuePaging = true;
      pageCount = 0; // Reset page count for subsequent polls
      totalAlertsFetched = 0; // Reset for subsequent polls
      const maxPages = 50; // Limit to 50 pages (500 alerts) per polling period to avoid rate limiting

      while (continuePaging && pageCount < maxPages) {
        pageCount++;

        // Fetch a page of alerts (getAlerts will filter by timestamp client-side)
        const { alerts, nextPageCursor } = await getAlerts(options, { from: lastCursor });

        lastCursor = nextPageCursor ? nextPageCursor : lastCursor;
        totalAlertsFetched += alerts.length;

        // Process alerts from this page
        if (alerts.length > 0) {
          processAlerts(alerts, options);
          totalAlertsProcessed += alerts.length;
        }

        if (alerts.length < DEFAULT_PAGE_SIZE) {
          continuePaging = false;
        }

        Logger.debug(
          {
            page: pageCount,
            alertsThisPage: alerts.length,
            totalAlertsProcessed,
            continuePaging,
            cursor: lastCursor
          },
          'Processed page of alerts'
        );

        // Add a small delay between page requests to avoid rate limiting
        // Only delay if we're continuing to the next page
        if (continuePaging) {
          await sleep(500); // 500ms delay between pages
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

    // Update polling state with current timestamp and cursor
    // Save the cursor so we can resume from this position in the next poll
    updatePollingState({
      lastPollTime: Date.now(),
      lastCursor: lastCursor,
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
    // Handle rate limiting (429) with a cleaner message
    const statusCode = error.statusCode || (error.meta && error.meta.statusCode);
    if (statusCode === 429) {
      Logger.warn(
        {
          statusCode: 429,
          message: 'Rate limit exceeded - too many requests to Dataminr API',
          pageCount,
          totalAlertsProcessed
        },
        'Rate limit exceeded during polling - will retry on next interval'
      );
      // Return success: false but don't log full stack trace
      return {
        success: false,
        error: 'Rate limit exceeded - will retry on next poll interval'
      };
    }

    // For other errors, log with minimal stack trace info
    Logger.error(
      {
        statusCode: statusCode,
        message: error.message || error.detail || 'Unknown error',
        detail: error.detail,
        pageCount,
        totalAlertsProcessed
      },
      'Polling Dataminr API Failed'
    );

    // Don't throw - allow polling to continue on next interval
    return {
      success: false,
      error: error.message || error.detail || 'Polling failed'
    };
  }
};

module.exports = pollAlerts;
