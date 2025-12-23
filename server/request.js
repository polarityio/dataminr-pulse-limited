const { get, getOr, filter, flow, negate, isEmpty } = require('lodash/fp');

const {
  logging: { getLogger },
  requests: { PolarityRequest },
  errors: { ApiRequestError }
} = require('polarity-integration-utils');

const { DateTime } = require('luxon');

const NodeCache = require('node-cache');
const tokenCache = new NodeCache();

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Extract retry delay from error response headers or use exponential backoff
 * @param {Object} error - The error object
 * @param {number} attemptNumber - Current retry attempt (0-indexed)
 * @returns {number} Delay in milliseconds
 */
const getRetryDelay = (error, attemptNumber) => {
  // Check for Retry-After header (in seconds)
  if (error.meta && error.meta.headers) {
    const retryAfter = error.meta.headers['retry-after'] || error.meta.headers['Retry-After'];
    if (retryAfter) {
      const retryAfterSeconds = parseInt(retryAfter, 10);
      if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
        // Convert to milliseconds and add a small buffer
        return (retryAfterSeconds + 1) * 1000;
      }
    }
  }

  // Exponential backoff: 2^attemptNumber seconds, with a max of 60 seconds
  // Attempt 0: 1s, Attempt 1: 2s, Attempt 2: 4s, Attempt 3: 8s, etc.
  const baseDelay = Math.min(Math.pow(2, attemptNumber), 60) * 1000;
  return baseDelay;
};

// Single request instance for all HTTP requests
const request = new PolarityRequest({
  roundedSuccessStatusCodes: [200],
  postprocessRequestFailure: (error) => {
    if (error instanceof ApiRequestError) {
      // Enhance error message with response details
      const errorBody = error.meta && error.meta.body;
      if (errorBody) {
        const message = errorBody.message || errorBody.errorMessage;
        if (message) {
          error.message = `${error.message} | ${message}`;
        }
      }
    }
    throw error;
  }
});

/**
 * Set the logger instance for the request module
 * @param {Object} logger - Logger instance
 * @returns {void}
 */
const setLogger = (logger) => {
  request.logger = logger;
};

/**
 * Clear cached token for the given options
 * @param {Object} options - Configuration options
 * @returns {void}
 */
const clearToken = (options) => {
  const tokenCacheKey = options.clientId + options.clientSecret;
  tokenCache.del(tokenCacheKey);
};

/**
 * Get authentication token from Dataminr API (with caching)
 * @param {Object} options - Configuration options
 * @param {string} options.clientId - Client ID for authentication
 * @param {string} options.clientSecret - Client secret for authentication
 * @param {string} options.url - Base URL for the API
 * @param {boolean} [forceRefresh=false] - If true, bypass cache and get a new token
 * @returns {Promise<string>} Resolves with the authentication token
 */
const getToken = async (options, forceRefresh = false) => {
  const tokenCacheKey = options.clientId + options.clientSecret;
  
  if (forceRefresh) {
    tokenCache.del(tokenCacheKey);
  } else {
    const cachedToken = tokenCache.get(tokenCacheKey);
    if (cachedToken) return cachedToken;
  }

  // Set userOptions before making request
  request.userOptions = options;

  try {
    const tokenResponse = await request.run({
      method: 'POST',
      url: `${options.url}/auth/v1/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      form: {
        grant_type: 'api_key',
        client_id: options.clientId,
        client_secret: options.clientSecret
      },
      json: true
    });

    const token = tokenResponse.body.dmaToken;
    const expireTime = tokenResponse.body.expire;

    tokenCache.set(
      tokenCacheKey,
      token,
      DateTime.fromMillis(expireTime).diffNow('seconds').seconds
    );

    return token;
  } catch (error) {
    const message = 'Failed to retrieve auth token - invalid clientId / clientSecret: ';
    if (error.name === 'ApiRequestError' && error.detail) {
      error.detail = message + error.detail;
    } else if (error.errors && Array.isArray(error.errors)) {
      error.errors = error.errors.map((error) => {
        if (error.message) {
          error.message = message + error.message;
        }
        return error;
      });
    }
    throw error;
  }
};

/**
 * Make an authenticated request to the Dataminr API with retry logic for rate limiting
 * @param {Object} params - Request parameters
 * @param {string} params.route - API route (e.g., '.../v1/alerts')
 * @param {Object} params.options - Configuration options
 * @param {Object} params.requestOptions - Additional request options (method, qs, headers, etc.)
 * @param {number} [maxRetries=3] - Maximum number of retry attempts for 429 errors (default: 3)
 * @returns {Promise<Object>} Resolves with the response object
 */
const requestWithDefaults = async ({ route, options, maxRetries = 3, ...requestOptions }) => {
  const Logger = getLogger();
  let token = await getToken(options);
  let tokenRefreshed = false;

  // Set userOptions before making request
  request.userOptions = options;

  let lastError;
  let attemptNumber = 0;

  while (attemptNumber <= maxRetries) {
    try {
      const response = await request.run({
        ...requestOptions,
        url: `${options.url}/${route}`,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(requestOptions.headers || {})
        },
        json: true
      });

      return response;
    } catch (error) {
      lastError = error;

      // Check if it's a 401 authentication error
      const errorStatus = error.status || error.statusCode || (error.meta && error.meta.statusCode);
      const isUnauthorizedError =
        (error instanceof ApiRequestError || error.name === 'ApiRequestError') &&
        (errorStatus === '401' || errorStatus === 401);

      // If we get a 401 and haven't refreshed the token yet, try to get a new token and retry once
      if (isUnauthorizedError && !tokenRefreshed) {
        Logger.warn(
          { route, errorStatus },
          'Received 401 unauthorized error, attempting to refresh token'
        );

        try {
          // Clear the cached token and get a new one
          clearToken(options);
          token = await getToken(options, true);
          tokenRefreshed = true;

          // Retry the request with the new token
          attemptNumber++;
          continue;
        } catch (tokenError) {
          // If getting a new token fails (e.g., invalid credentials), throw immediately
          // Don't retry as this indicates a configuration issue, not an expired token
          Logger.error(
            { route, tokenError },
            'Failed to refresh token, credentials may be invalid'
          );
          throw tokenError;
        }
      }

      // Check if it's a 429 rate limit error
      const isRateLimitError =
        (error instanceof ApiRequestError || error.name === 'ApiRequestError') &&
        (errorStatus === '429' || errorStatus === 429 || String(error.message || error.detail || '').includes('429'));

      if (isRateLimitError && attemptNumber < maxRetries) {
        const retryDelay = getRetryDelay(error, attemptNumber);
        Logger.warn(
          { route, attemptNumber: attemptNumber + 1, maxRetries, retryDelayMs: retryDelay },
          'Rate limit (429) encountered, retrying request'
        );

        await sleep(retryDelay);
        attemptNumber++;
        continue;
      }

      throw error;
    }
  }

  // If we've exhausted all retries, throw the last error
  Logger.error(
    {
      route,
      maxRetries,
      finalAttempt: attemptNumber
    },
    'Max retries exceeded for rate-limited request'
  );
  throw lastError;
};

/**
 * Execute multiple requests in parallel
 * @param {Array<Object>} requestsOptions - Array of request options, each optionally containing resultId
 * @param {string} responseGetPath - Lodash path to extract from response (e.g., 'body.alerts')
 * @param {number} limit - Maximum number of parallel requests (default: 10)
 * @param {boolean} onlyReturnPopulatedResults - If true, filter out empty/null results (default: true)
 * @returns {Promise<Array>} Resolves with array of results, optionally keyed by resultId
 */
const requestsInParallel = async (
  requestsOptions,
  responseGetPath,
  limit = 10,
  onlyReturnPopulatedResults = true
) => {
  const requestPromises = requestsOptions.map(async ({ resultId, ...requestOptions }) => {
    try {
      const response = await requestWithDefaults(requestOptions);
      const result = responseGetPath ? get(responseGetPath, response) : response;
      return resultId ? { resultId, result } : result;
    } catch (error) {
      // Log error but continue processing other requests
      console.error('Request failed:', error.message);
      return resultId ? { resultId, result: null, error: error.message } : null;
    }
  });

  const results = await Promise.all(requestPromises);

  return onlyReturnPopulatedResults
    ? filter(
        flow((result) => getOr(result, 'result', result), negate(isEmpty)),
        results
      )
    : results;
};

module.exports = {
  requestWithDefaults,
  requestsInParallel,
  setLogger
};
