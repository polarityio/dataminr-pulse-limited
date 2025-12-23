const { isEmpty, get } = require('lodash/fp');
const reduce = require('lodash/fp/reduce').convert({ cap: false });

/**
 * Validate string options from the options object
 * @param {Object<string, string>} stringOptionsErrorMessages - Map of option names to error messages
 * @param {Object} options - Options object to validate
 * @param {Array<Object>} [otherErrors] - Additional errors to include (default: [])
 * @returns {Array<Object>} Array of validation error objects with key and message properties
 */
const validateStringOptions = (stringOptionsErrorMessages, options, otherErrors = []) =>
  reduce((agg, message, optionName) => {
    const option = options[optionName];
    if (!option || !option.value) {
      return agg.concat({
        key: optionName,
        message
      });
    }
    
    const isString = typeof option.value === 'string';
    const isEmptyString = isString && isEmpty(option.value);

    return !isString || isEmptyString
      ? agg.concat({
          key: optionName,
          message
        })
      : agg;
  }, otherErrors)(stringOptionsErrorMessages);

/**
 * Validate URL option format and structure
 * @param {Object} options - Options object containing the URL
 * @param {string} [urlKey='url'] - Key name for the URL option
 * @returns {Array<Object>} Array of validation error objects with key and message properties
 */
const validateUrlOption = (options, urlKey = 'url') => {
  let allValidationErrors = [];

  const urlValue = get([urlKey, 'value'], options);

  if (!urlValue) {
    return allValidationErrors;
  }

  if (typeof urlValue === 'string' && urlValue.endsWith('/')) {
    allValidationErrors = allValidationErrors.concat({
      key: urlKey,
      message: 'Your Url must not end with a /'
    });
  }

  if (urlValue) {
    try {
      new URL(urlValue);
    } catch (_) {
      allValidationErrors = allValidationErrors.concat({
        key: urlKey,
        message:
          'What is currently provided is not a valid URL. You must provide a valid Instance URL.'
      });
    }
  }

  return allValidationErrors;
};

module.exports = {
  validateStringOptions,
  validateUrlOption
};
