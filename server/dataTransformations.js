const {
  map,
  filter,
  get,
  flow,
  eq,
  flatMap,
  uniqWith,
  isEqual,
  identity,
  first,
  toLower,
  some
} = require('lodash/fp');

/**
 * Check if an IP address is a private IP address
 * @param {string} ip - IP address to check
 * @returns {boolean} True if the IP is private (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
 */
const isPrivateIP = (ip) => {
  const parts = ip.split('.');
  return (
    parts[0] === '10' ||
    (parts[0] === '172' &&
      parseInt(parts[1], 10) >= 16 &&
      parseInt(parts[1], 10) <= 31) ||
    (parts[0] === '192' && parts[1] === '168')
  );
};

/**
 * Filter out entities that are private IP addresses
 * @param {Array<Object>} entities - Array of entity objects
 * @returns {Array<Object>} Filtered array of entities excluding private IPs
 */
const removePrivateIps = (entities) =>
  filter(({ isIP, value }) => !isIP || (isIP && !isPrivateIP(value)), entities);

/**
 * Filter entities by their types
 * @param {string|Array<string>} typesToGet - Entity type(s) to filter for
 * @param {Array<Object>} entities - Array of entity objects with types property
 * @returns {Array<Object>} Filtered array of entities matching the specified types
 */
const getEntityTypes = (typesToGet, entities) => {
  const lowerTypesToGet =
    typeof typesToGet === 'string' ? [toLower(typesToGet)] : map(toLower, typesToGet);

  const entitiesOfTypesToGet = filter((entity) => {
    const lowerEntityTypes = map(toLower, entity.types);

    const entityTypesAreInTypesToGet = some(
      (typeToGet) => lowerEntityTypes.includes(typeToGet),
      lowerTypesToGet
    );

    return entityTypesAreInTypesToGet;
  }, entities);

  return entitiesOfTypesToGet;
};

/**
 * Get results for a specific entity from the results array
 * @param {Object} entity - Entity object with value property
 * @param {Array<Object>} results - Array of result objects with resultId and result properties
 * @param {boolean} onlyOneResultExpected - If true, return only the first result (default: false)
 * @param {boolean} onlyReturnUniqueResults - If true, deduplicate results (default: false)
 * @returns {Object|Array<Object>|undefined} Result(s) for the entity or undefined if not found
 */
const getResultForThisEntity = (
  entity,
  results,
  onlyOneResultExpected = false,
  onlyReturnUniqueResults = false
) =>
  flow(
    filter(flow(get('resultId'), eq(entity.value))),
    flatMap(get('result')),
    onlyReturnUniqueResults ? uniqWith(isEqual) : identity,
    onlyOneResultExpected ? first : identity
  )(results);

module.exports = {
  removePrivateIps,
  getEntityTypes,
  getResultForThisEntity
};
