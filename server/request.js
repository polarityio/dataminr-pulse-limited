const { get, getOr, filter, flow, negate, isEmpty } = require('lodash/fp');

const {
  requests: { PolarityRequest },
  errors: { ApiRequestError }
} = require('polarity-integration-utils');

const { CAL_API_URL } = require('../constants');
const crypto = require('crypto');
const { URL } = require('url');

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


function unixEpochTimeInSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Set the logger instance for the request module
 * @param {Object} logger - Logger instance
 * @returns {void}
 */
const setLogger = (logger) => {
  request.logger = logger;
};

/**
 * Make an authenticated request to the Dataminr API
 * @param {Object} params - Request parameters
 * @param {Object} params.options - Configuration options
 * @param {Object} params.requestOptions - Additional request options (method, qs, headers, etc.)
 * @returns {Promise<Object>} Resolves with the response object
 */
const requestWithDefaults = async ({ options, ...requestOptions }) => {
  const time = unixEpochTimeInSeconds();
  const authType = 'HELIX';
  const instanceId = options.clientId;
  const key = options.clientSecret;

  // Build full request URL; override `since` from options when provided (for incremental polling)
  const baseUrl = new URL(CAL_API_URL);
  if (options.since !== undefined && options.since !== null) {
    baseUrl.searchParams.set('since', String(options.since));
  }
  const pathname = baseUrl.pathname;
  const requestUrl = baseUrl.toString();

  // Sign using pathname (with leading slash) to match server expectation, per reference PolarityRequest
  const toSign = `${pathname}:${requestOptions.method.toUpperCase()}:${time}`;

  const hmacSignatureInBase64 = crypto
    .createHmac('sha256', key)
    .update(toSign)
    .digest('base64');
  const authHeader = `${authType} ${instanceId}:${hmacSignatureInBase64}`;

  request.userOptions = options;

  return request.run({
    ...requestOptions,
    url: requestUrl,
    headers: {
      Accept: 'application/zip',
      Authorization: authHeader,
      Timestamp: time,
      ...(requestOptions.headers || {})
    },
    json: false,
    encoding: null
  });
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
