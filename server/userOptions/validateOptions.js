const { validateStringOptions, validateUrlOption } = require('./utils');

/**
 * Validate integration options
 * @param {Object} options - Options object to validate
 * @param {Function} callback - Callback function (error, validationErrors)
 * @param {Error} [callback.error] - Error object if validation fails
 * @param {Array<Object>} callback.validationErrors - Array of validation error objects
 * @returns {Promise<void>} Resolves when validation is complete
 */
const validateOptions = async (options, callback) => {
  try {
    // Handle case where options might be undefined or null
    if (!options) {
      options = {};
    }

    const stringOptionsErrorMessages = {
      url: '* Required',
      clientId: '* Required',
      clientSecret: '* Required'
    };

    const stringValidationErrors = validateStringOptions(
      stringOptionsErrorMessages,
      options
    );

    const urlValidationError = validateUrlOption(options, 'url');

    const errors = stringValidationErrors.concat(urlValidationError);

    callback(null, errors);
  } catch (error) {
    callback(error);
  }
};

module.exports = validateOptions;
