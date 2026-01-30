const Handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { getAlertById } = require('./alerts/getAlerts');
const { TRIAL_MODE } = require('../constants');

let templateCache = null;
let notificationTemplateCache = null;

/**
 * Load and compile the alert detail template
 * @returns {HandlebarsTemplateDelegate} Compiled template
 */
function loadTemplate() {
  if (templateCache) {
    return templateCache;
  }

  const templatePath = path.join(__dirname, '..', 'client', 'block.hbs');
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  templateCache = Handlebars.compile(templateSource);
  return templateCache;
}

/**
 * Load and compile the alert notification template
 * @returns {HandlebarsTemplateDelegate} Compiled template
 */
function loadNotificationTemplate() {
  if (notificationTemplateCache) {
    return notificationTemplateCache;
  }

  const templatePath = path.join(__dirname, '..', 'client', 'notifications.hbs');
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  notificationTemplateCache = Handlebars.compile(templateSource);
  return notificationTemplateCache;
}

/**
 * Register Handlebars helpers
 */
function registerHelpers() {
  // Equality helper
  Handlebars.registerHelper('eq', function (a, b) {
    return a === b;
  });

  // Greater than helper
  Handlebars.registerHelper('gt', function (a, b) {
    return a > b;
  });

  // Logical OR helper - returns true if any argument is truthy
  Handlebars.registerHelper('or', function () {
    // Get all arguments except the last one (which is the options object)
    const args = Array.prototype.slice.call(arguments, 0, -1);
    return args.some(function (arg) {
      return !!arg;
    });
  });
}

// Register helpers on module load
registerHelpers();

/**
 * Format timestamp helper function (used in preprocessing)
 * @param {string|number} timestamp - Timestamp to format
 * @param {string} [timezone] - Optional timezone (e.g., 'America/New_York', 'UTC')
 * @returns {string} Formatted timestamp with timezone indicator
 */
function formatTimestampValue(timestamp, timezone) {
  if (!timestamp) return '';

  let date;
  if (typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else if (typeof timestamp === 'string') {
    date = new Date(timestamp);
  } else {
    return '';
  }

  if (isNaN(date.getTime())) {
    return '';
  }

  // Format date with timezone if provided
  let formattedDate;
  let timezoneLabel = '';

  if (timezone) {
    try {
      // Use Intl.DateTimeFormat to format with timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      formattedDate = formatter.format(date);

      // Get timezone abbreviation (e.g., EST, PST, UTC)
      const tzFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'short'
      });
      const parts = tzFormatter.formatToParts(date);
      const tzPart = parts.find((part) => part.type === 'timeZoneName');
      timezoneLabel = tzPart ? ' ' + tzPart.value : '';
    } catch (error) {
      // Fallback to default formatting if timezone is invalid
      console.error('Invalid timezone:', timezone, error);
      formattedDate = null;
    }
  }

  // Fallback to original formatting if no timezone or timezone formatting failed
  if (!formattedDate) {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();

    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();

    formattedDate =
      hours + ':' + minutesStr + ' ' + ampm + ' ' + month + ' ' + day + ', ' + year;

    // If no timezone provided, indicate what timezone is being displayed (local time)
    if (!timezone) {
      try {
        const localTzFormatter = new Intl.DateTimeFormat('en-US', {
          timeZoneName: 'short'
        });
        const localParts = localTzFormatter.formatToParts(date);
        const localTzPart = localParts.find((part) => part.type === 'timeZoneName');
        timezoneLabel = localTzPart ? ' (' + localTzPart.value + ')' : '';
      } catch (error) {
        // Ignore error, just don't show timezone
      }
    }
  }

  return formattedDate + timezoneLabel;
}

/**
 * Normalize alert type for CSS class
 * @param {string} alertType - Alert type name
 * @returns {string} Normalized alert type
 */
function normalizeAlertTypeValue(alertType) {
  if (!alertType || typeof alertType !== 'string') {
    return 'alert';
  }
  return alertType.toLowerCase().replace('update', '').trim();
}

/**
 * Convert string to title case
 * @param {string} str - String to convert
 * @returns {string} Title case string
 */
function toTitleCaseValue(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  let s = str.toLowerCase();
  return s.replace(/\b\w/g, function (char) {
    return char.toUpperCase();
  });
}

/**
 * Format type header text
 * @param {string} type - Type string
 * @returns {string} Formatted type header
 */
function formatTypeHeaderValue(type) {
  if (!type || typeof type !== 'string') {
    return '';
  }
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() + ' context';
}

/**
 * Join array with property access
 * @param {Array} array - Array to join
 * @param {string} separator - Separator string
 * @param {string} property - Property name to access
 * @returns {string} Joined string
 */
function joinArray(array, separator, property) {
  if (!Array.isArray(array) || array.length === 0) {
    return '';
  }
  return array
    .map(function (item) {
      return property ? item[property] || '' : item;
    })
    .filter(function (item) {
      return item !== '';
    })
    .join(separator || ', ');
}

/**
 * Format addresses array
 * @param {Array} addresses - Array of address objects
 * @returns {string} Formatted addresses string
 */
function formatAddressesValue(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return '';
  }
  return addresses
    .map(function (address) {
      const ip = address.ip || '';
      const port = address.port ? ':' + address.port : '';
      const version = address.version ? ' (' + address.version + ')' : '';
      return ip + port + version;
    })
    .join(', ');
}

/**
 * Format AS organizations array
 * @param {Array} asOrgs - Array of AS org objects
 * @returns {string} Formatted AS orgs string
 */
function formatAsOrgsValue(asOrgs) {
  if (!Array.isArray(asOrgs) || asOrgs.length === 0) {
    return '';
  }
  return asOrgs
    .map(function (asOrg) {
      const asn = asOrg.asn || '';
      const asOrgName = asOrg.asOrg ? ' (' + asOrg.asOrg + ')' : '';
      return asn + asOrgName;
    })
    .join(', ');
}

/**
 * Format hashes array
 * @param {Array} hashes - Array of hash objects
 * @returns {string} Formatted hashes string
 */
function formatHashesValue(hashes) {
  if (!Array.isArray(hashes) || hashes.length === 0) {
    return '';
  }
  return hashes
    .map(function (hash) {
      const value = hash.value || '';
      const type = hash.type ? ' (' + hash.type + ')' : '';
      return value + type;
    })
    .join(', ');
}

/**
 * Format vulnerabilities array
 * @param {Array} vulnerabilities - Array of vulnerability objects
 * @returns {string} Formatted vulnerabilities string
 */
function formatVulnerabilitiesValue(vulnerabilities) {
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
    return '';
  }
  return vulnerabilities
    .map(function (vuln) {
      const id = vuln.id || '';
      const cvss =
        vuln.cvss !== undefined && vuln.cvss !== null ? ' (CVSS: ' + vuln.cvss + ')' : '';
      let parts = [id + cvss];

      // Add products if available
      if (vuln.products && Array.isArray(vuln.products) && vuln.products.length > 0) {
        const productStrings = vuln.products
          .map(function (product) {
            const vendor = product.productVendor || '';
            const name = product.productName || '';
            const version = product.productVersion || '';
            const parts = [];
            if (vendor) parts.push(vendor);
            if (name) parts.push(name);
            if (version) parts.push(version);
            return parts.join(' ');
          })
          .filter(function (str) {
            return str.length > 0;
          });
        if (productStrings.length > 0) {
          parts.push('Products: ' + productStrings.join(', '));
        }
      }

      // Add exploit links if available
      if (
        vuln.exploitPocLinks &&
        Array.isArray(vuln.exploitPocLinks) &&
        vuln.exploitPocLinks.length > 0
      ) {
        const links = vuln.exploitPocLinks.filter(function (link) {
          return link && typeof link === 'string' && link.trim().length > 0;
        });
        if (links.length > 0) {
          parts.push('Exploits: ' + links.join(', '));
        }
      }

      return parts.join(' - ');
    })
    .join(' | ');
}

/**
 * Limit array to 3 items (first 2 + summary)
 * @param {Array} array - Array to limit
 * @param {string} itemType - Type of item for summary text (e.g., 'products', 'vendors', 'links')
 * @returns {Object} Object with limited array and summary info
 */
function limitListToFour(array, itemType) {
  if (!Array.isArray(array) || array.length === 0) {
    return {
      items: [],
      hasMore: false,
      moreCount: 0,
      moreText: ''
    };
  }

  if (array.length <= 3) {
    return {
      items: array,
      hasMore: false,
      moreCount: 0,
      moreText: ''
    };
  }

  const firstThree = array.slice(0, 2);
  const remaining = array.length - 2;

  // Handle singular/plural forms
  let itemTypeSingular = itemType.replace(/s$/, ''); // Remove trailing 's' if present
  if (itemType === 'links') {
    itemTypeSingular = 'link';
  }

  return {
    items: firstThree,
    hasMore: true,
    moreCount: remaining,
    moreText:
      '+' + remaining + ' additional ' + (remaining === 1 ? itemTypeSingular : itemType)
  };
}

/**
 * Process vulnerabilities array for structured display
 * @param {Array} vulnerabilities - Array of vulnerability objects
 * @returns {Object} Processed vulnerabilities with first item and additional count
 */
function processVulnerabilities(vulnerabilities) {
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
    return null;
  }

  const processed = vulnerabilities.map(function (vuln) {
    // Extract unique vendors
    const vendors = [];
    if (vuln.products && Array.isArray(vuln.products)) {
      vuln.products.forEach(function (product) {
        const vendor = product.productVendor || '';
        if (vendor && vendors.indexOf(vendor) === -1) {
          vendors.push(vendor);
        }
      });
    }

    // Limit vendors to 4 items
    const vendorsLimited = limitListToFour(vendors, 'vendors');

    // Limit products to 4 items
    const productsLimited = limitListToFour(vuln.products || [], 'products');

    // Limit exploit links to 4 items
    const exploitLinksLimited = limitListToFour(vuln.exploitPocLinks || [], 'links');

    return {
      id: vuln.id || '',
      cvss: vuln.cvss !== undefined && vuln.cvss !== null ? vuln.cvss : null,
      vendors: vendorsLimited,
      products: productsLimited,
      exploitPocLinks: exploitLinksLimited,
      // Store full lists for expanded view
      vendorsFull: vendors,
      productsFull: vuln.products || [],
      exploitPocLinksFull: vuln.exploitPocLinks || []
    };
  });

  // Check if first vulnerability has any truncated lists
  const firstVuln = processed[0] || null;
  const hasTruncatedLists =
    firstVuln &&
    (firstVuln.vendors.hasMore ||
      firstVuln.products.hasMore ||
      firstVuln.exploitPocLinks.hasMore);

  return {
    first: firstVuln,
    all: processed,
    additionalCount: processed.length > 1 ? processed.length - 1 : 0,
    hasTruncatedLists: hasTruncatedLists || false
  };
}

/**
 * Format companies array
 * @param {Array} companies - Array of company objects
 * @returns {string} Formatted companies string
 */
function formatCompaniesValue(companies) {
  if (!Array.isArray(companies) || companies.length === 0) {
    return '';
  }
  return companies
    .map(function (company) {
      const name = company.name || '';
      const ticker = company.ticker ? ' (' + company.ticker + ')' : '';
      return name + ticker;
    })
    .join(' | ');
}

/**
 * Format sectors array
 * @param {Array} sectors - Array of sector objects
 * @returns {string} Formatted sectors string
 */
function formatSectorsValue(sectors) {
  return formatNamesValue(sectors);
}

/**
 * Format topics array
 * @param {Array} topics - Array of topic objects
 * @returns {string} Formatted topics string
 */
function formatTopicsValue(topics) {
  return formatNamesValue(topics);
}

/**
 * Format lists matched array
 * @param {Array} listsMatched - Array of list matched objects
 * @returns {string} Formatted lists matched string
 */
function formatListsMatchedValue(listsMatched) {
  return formatNamesValue(listsMatched);
}

/**
 * Format names array
 * @param {Array} items - Array of item objects
 * @param {string} delimiter - Delimiter string
 * @returns {string} Formatted names string
 */
function formatNamesValue(items, delimiter = ' | ') {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return items
    .map(function (item) {
      return item.name || '';
    })
    .join(delimiter);
}

/**
 * Process metadata from alert
 * @param {Object} alert - Alert object
 * @returns {Object|null} Processed metadata or null
 */
function processMetadata(alert) {
  if (!alert.metadata || !alert.metadata.cyber) {
    return null;
  }

  const metadata = alert.metadata.cyber;
  const hasMetadata =
    (metadata.threatActors && metadata.threatActors.length > 0) ||
    (metadata.URL && metadata.URL.length > 0) ||
    (metadata.addresses && metadata.addresses.length > 0) ||
    (metadata.asOrgs && metadata.asOrgs.length > 0) ||
    (metadata.hashValues && metadata.hashValues.length > 0) ||
    (metadata.malware && metadata.malware.length > 0) ||
    (metadata.vulnerabilities && metadata.vulnerabilities.length > 0);

  if (!hasMetadata) {
    return null;
  }

  const vulnerabilitiesData = metadata.vulnerabilities
    ? processVulnerabilities(metadata.vulnerabilities)
    : null;

  return {
    threatActors: metadata.threatActors || [],
    threatActorsFormatted: metadata.threatActors
      ? joinArray(metadata.threatActors, ', ', 'name')
      : '',
    URL: metadata.URL || [],
    URLFormatted: metadata.URL ? joinArray(metadata.URL, ', ', 'name') : '',
    addresses: metadata.addresses || [],
    addressesFormatted: metadata.addresses
      ? formatAddressesValue(metadata.addresses)
      : '',
    asOrgs: metadata.asOrgs || [],
    asOrgsFormatted: metadata.asOrgs ? formatAsOrgsValue(metadata.asOrgs) : '',
    hashValues: metadata.hashValues || [],
    hashValuesFormatted: metadata.hashValues
      ? formatHashesValue(metadata.hashValues)
      : '',
    malware: metadata.malware || [],
    malwareFormatted: metadata.malware ? joinArray(metadata.malware, ', ', 'name') : '',
    vulnerabilities: metadata.vulnerabilities || [],
    vulnerabilitiesFormatted: metadata.vulnerabilities
      ? formatVulnerabilitiesValue(metadata.vulnerabilities)
      : '',
    vulnerabilitiesData: vulnerabilitiesData
  };
}

/**
 * Process live brief from alert
 * @param {Object} alert - Alert object
 * @param {string} [timezone] - Optional timezone for timestamp formatting
 * @returns {Object|null} Processed live brief data or null
 */
function processLiveBrief(alert, timezone) {
  if (!alert.liveBrief || !Array.isArray(alert.liveBrief)) {
    return null;
  }

  const liveBriefs = alert.liveBrief.filter(function (lb) {
    return lb.version === 'current';
  });

  if (liveBriefs.length === 0) {
    return null;
  }

  const hasMultipleLiveBriefs = liveBriefs.length > 1;
  const processed = liveBriefs.map(function (lb, index) {
    const title = hasMultipleLiveBriefs ? 'Live Brief ' + index : 'Live Brief';
    return {
      version: lb.version,
      summary: lb.summary || '',
      timestamp: lb.timestamp || '',
      timestampFormatted: formatTimestampValue(lb.timestamp, timezone),
      title: title
    };
  });

  // Build copy text
  const copyText = liveBriefs
    .map(function (lb) {
      return lb.summary || '';
    })
    .filter(function (summary) {
      return summary !== '';
    })
    .join('\n\n');

  return {
    liveBrief: processed,
    liveBriefCopyText: copyText
  };
}

/**
 * Process discovered entities from intel agents
 * @param {Array<Object>} agents - Array of intel agent objects
 * @param {string} alertUrl - Alert URL for building entity detail URLs
 * @returns {Array<Object>} Array of discovered entity objects
 */
function processDiscoveredEntities(agents, alertUrl) {
  const discoveredEntities = [];

  agents.forEach(function (agent) {
    if (
      agent.version === 'current' &&
      agent.discoveredEntities &&
      agent.discoveredEntities.length > 0
    ) {
      agent.discoveredEntities.forEach(function (entity) {
        if (entity && entity.name) {
          // Future baseUrl: https://app.dataminr.com/#entities/${entityId}/alertDetailWL/2079127/
          const baseUrl = 'https://app.dataminr.com/#entities/alertDetailWL/2079127/';
          const entityDetailUrl = alertUrl
            ? alertUrl.replace('https://app.dataminr.com/#', baseUrl)
            : '';
          // Format aliases as comma-separated string for data attribute
          const aliasesArray = entity.aliases || [];
          const aliasesFormatted = Array.isArray(aliasesArray)
            ? aliasesArray.filter((alias) => alias && alias.trim()).join(',')
            : '';

          // Include full entity data for modal display
          const entityData = {
            name: entity.name,
            url: entityDetailUrl,
            aliases: aliasesArray,
            aliasesFormatted: aliasesFormatted,
            summary: entity.summary || '',
            type: entity.type || '',
            products: entity.products || [],
            cvss: entity.cvss,
            epssScore: entity.epssScore,
            countryOfOrigin: entity.countryOfOrigin || '',
            exploitable: entity.exploitable,
            ttps: entity.ttps || []
          };
          
          // Add JSON string for easy access in client-side code
          entityData.entityJson = JSON.stringify(entityData);
          
          discoveredEntities.push(entityData);
        }
      });
    }
  });

  return discoveredEntities;
}

/**
 * Process intel agent summaries grouped by type
 * @param {Array<Object>} agents - Array of intel agent objects
 * @returns {Array<Object>} Array of grouped summary objects
 */
function processIntelAgentSummaries(agents) {
  const groupedSummaries = [];

  agents.forEach(function (agent) {
    if (agent.version === 'current' && agent.summary && agent.summary.length > 0) {
      const summariesByType = {};
      agent.summary.forEach(function (summaryItem) {
        if (summaryItem.type && summaryItem.type.length > 0) {
          const type = summaryItem.type[0];
          if (!summariesByType[type]) {
            summariesByType[type] = [];
          }
          summariesByType[type].push({
            type: type,
            title: summaryItem.title || '',
            content: summaryItem.content || [],
            contentText: Array.isArray(summaryItem.content)
              ? summaryItem.content.join(' ')
              : ''
          });
        }
      });

      Object.keys(summariesByType).forEach(function (type) {
        groupedSummaries.push({
          type: type,
          typeHeader: formatTypeHeaderValue(type),
          summaries: summariesByType[type]
        });
      });
    }
  });

  return groupedSummaries;
}

/**
 * Build copy text for intel agents
 * @param {Array<Object>} groupedSummaries - Array of grouped summary objects
 * @returns {string} Copy text string
 */
function buildIntelAgentsCopyText(groupedSummaries) {
  const copyTextParts = [];
  groupedSummaries.forEach(function (group) {
    const typeHeader =
      group.type.charAt(0).toUpperCase() + group.type.slice(1).toLowerCase() + ' context';
    copyTextParts.push(typeHeader);

    group.summaries.forEach(function (summaryItem) {
      const title = summaryItem.title || '';
      const contentText = summaryItem.contentText || '';

      if (title) {
        copyTextParts.push(title + (contentText ? ': ' + contentText : ''));
      } else if (contentText) {
        copyTextParts.push(contentText);
      }
    });
  });
  return copyTextParts.join('\n');
}

/**
 * Process intel agents from alert
 * @param {Object} alert - Alert object
 * @returns {Object|null} Processed intel agents data or null
 */
function processIntelAgents(alert) {
  if (!alert.intelAgents || !Array.isArray(alert.intelAgents)) {
    return null;
  }

  const groupedSummaries = processIntelAgentSummaries(alert.intelAgents);
  const discoveredEntities = processDiscoveredEntities(
    alert.intelAgents,
    alert.dataminrAlertUrl
  );

  if (groupedSummaries.length === 0 && discoveredEntities.length === 0) {
    return null;
  }

  const result = {};
  if (groupedSummaries.length > 0) {
    result.intelAgentsGrouped = groupedSummaries;
    result.intelAgentsCopyText = buildIntelAgentsCopyText(groupedSummaries);
  }
  if (discoveredEntities.length > 0) {
    result.discoveredEntities = discoveredEntities;
  }

  return result;
}

/**
 * Process public post media from alert
 * Handles both First Alert API and Pulse API formats (both use arrays of media objects with type and href)
 * @param {Object} alert - Alert object (from either First Alert API or Pulse API)
 * @returns {Array<Object>|null} Processed media by type or null
 */
function processMedia(alert) {
  if (
    !alert.publicPost ||
    !alert.publicPost.media ||
    !Array.isArray(alert.publicPost.media)
  ) {
    return null;
  }

  const mediaByType = {};
  alert.publicPost.media.forEach(function (media) {
    const type = media.type || 'unknown';
    if (!mediaByType[type]) {
      mediaByType[type] = [];
    }
    mediaByType[type].push(media);
  });

  return Object.keys(mediaByType).map(function (type) {
    const media = mediaByType[type];
    const mediaCount = media.length;
    let typeHeader = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    if (mediaCount > 1) {
      typeHeader += 's (' + mediaCount + ')';
    }

    let gridStyle = null;
    if (type === 'image' || type === 'photo') {
      gridStyle =
        mediaCount > 1
          ? 'grid-template-columns: repeat(' + mediaCount + ', 1fr);'
          : 'grid-template-columns: 1fr;';
    }

    let fullStyleAttribute = '';
    if (gridStyle) {
      fullStyleAttribute = ' style="' + gridStyle + '"';
    }

    return {
      type: type,
      typeHeader: typeHeader,
      media: media,
      gridStyle: gridStyle || '',
      styleAttribute: fullStyleAttribute
    };
  });
}

/**
 * Process a single linked alert
 * @param {Object} linkedAlert - Linked alert object
 * @param {string} [timezone] - Optional timezone for timestamp formatting
 * @returns {Object} Processed linked alert object
 */
function processSingleLinkedAlert(linkedAlert, timezone) {
  const alertType =
    linkedAlert.publicPost && linkedAlert.publicPost.channels
      ? linkedAlert.publicPost.channels[0]
      : '';

  // Get first image/photo from media if available
  let imageUrl = '';
  if (
    linkedAlert.publicPost &&
    linkedAlert.publicPost.media &&
    Array.isArray(linkedAlert.publicPost.media)
  ) {
    const imageMedia = linkedAlert.publicPost.media.find(function (media) {
      return media.type === 'image' || media.type === 'photo';
    });
    if (imageMedia && imageMedia.href) {
      imageUrl = imageMedia.href;
    }
  }

  return {
    alertId: linkedAlert.alertId || '',
    alertTimestamp: linkedAlert.alertTimestamp || '',
    alertTimestampFormatted: formatTimestampValue(linkedAlert.alertTimestamp, timezone),
    headline: linkedAlert.headline || 'No headline available',
    alertType: alertType,
    alertTypeFormatted: toTitleCaseValue(alertType),
    imageUrl: imageUrl
  };
}

/**
 * Process linked alerts from alert
 * @param {Object} alert - Alert object
 * @param {Object} options - Options object
 * @param {string} [timezone] - Optional timezone for timestamp formatting
 * @returns {Promise<Array<Object>|null>} Processed linked alerts array or null
 */
async function processLinkedAlerts(alert, options, timezone) {
  if (
    !alert.linkedAlerts ||
    !Array.isArray(alert.linkedAlerts) ||
    alert.linkedAlerts.length === 0
  ) {
    return null;
  }

  // Filter to only linked alerts with parentAlertId and not the current alert
  /*
    When fully implemented, this may also have childAlertIds or siblingAlertIds to process.
  */
  const linkedAlertPromises = alert.linkedAlerts
    .filter(function (linkedAlertItem) {
      return (
        linkedAlertItem.parentAlertId && linkedAlertItem.parentAlertId !== alert.alertId
      );
    })
    .map(function (linkedAlertItem) {
      return getAlertById(linkedAlertItem.parentAlertId);
    });

  // Fetch all linked alerts in parallel
  const linkedAlertsResults = await Promise.all(linkedAlertPromises);
  const linkedAlerts = linkedAlertsResults.filter(function (linkedAlert) {
    return linkedAlert !== null && linkedAlert.alertId;
  });

  if (!linkedAlerts || linkedAlerts.length === 0) {
    return null;
  }

  // Process each linked alert
  const processedLinkedAlerts = linkedAlerts.map(function (linkedAlert) {
    return processSingleLinkedAlert(linkedAlert, timezone);
  });

  // Sort alerts by timestamp (most recent first)
  processedLinkedAlerts.sort(function (a, b) {
    const timeA = a.alertTimestamp ? new Date(a.alertTimestamp).getTime() : 0;
    const timeB = b.alertTimestamp ? new Date(b.alertTimestamp).getTime() : 0;
    return timeB - timeA;
  });

  return processedLinkedAlerts;
}

/**
 * Process alert reference terms
 * Handles both API formats: Pulse API uses strings, First Alert API uses objects with text property
 * Normalizes both to objects with text property for consistent template rendering
 * @param {Object} alert - Alert object (from either First Alert API or Pulse API)
 * @returns {Array<Object>|null} Processed reference terms array (objects with text property) or null
 */
function processReferenceTerms(alert) {
  if (!alert.alertReferenceTerms || !Array.isArray(alert.alertReferenceTerms)) {
    return null;
  }

  const processed = alert.alertReferenceTerms
    .map(function (term) {
      // If term is already an object with text property, use it
      if (typeof term === 'object' && term !== null && term.text) {
        return { text: term.text };
      }
      // If term is a string, wrap it in an object
      if (typeof term === 'string') {
        return { text: term };
      }
      // If term is an object but no text property, try to extract text or use empty string
      if (typeof term === 'object' && term !== null) {
        return { text: term.text || term.name || term.value || '' };
      }
      // Fallback
      return { text: String(term || '') };
    })
    .filter(function (term) {
      // Filter out empty terms
      return term.text && term.text.trim().length > 0;
    });

  // Set to null if no valid terms after filtering
  if (processed.length === 0) {
    return null;
  }

  return processed;
}

/**
 * Extract timezone from options (payload, request headers, or options object)
 * @param {Object} options - Options object that may contain timezone
 * @returns {string|undefined} Timezone string or undefined
 */
function extractTimezone(options) {
  if (!options) {
    return undefined;
  }

  // Check payload first (from client request) - this is set when timezone is passed from client
  if (options.timezone) {
    return options.timezone;
  }

  // Check request headers (e.g., X-Timezone header)
  if (options._request && options._request.headers) {
    const tzHeader =
      options._request.headers['x-timezone'] || options._request.headers['X-Timezone'];
    if (tzHeader) {
      return tzHeader;
    }
  }

  return undefined;
}

/**
 * Process alert data for template rendering (preprocesses all helper-dependent values)
 * Handles both First Alert API and Pulse API formats which have some differences:
 * - Pulse API includes: alertCompanies, alertSectors, intelAgents, metadata, publicPost.timestamp, publicPost.channels, listsMatched.subType, listsMatched.locationGroups
 * - First Alert API includes: estimatedEventLocation.MGRS
 * - alertReferenceTerms: Pulse uses strings, First Alert uses objects with text property (handled by processReferenceTerms)
 * - Media structure: Both APIs use arrays of objects with type and href (handled by processMedia)
 * @param {Object} alert - Alert object (from either First Alert API or Pulse API)
 * @param {Object} options - Options object
 * @returns {Promise<Object>} Processed alert data for template
 */
async function processAlertData(alert, options) {
  if (!alert) {
    return null;
  }

  // Extract timezone from options
  const timezone = extractTimezone(options);

  const alertTypeName =
    alert.alertType && alert.alertType.name ? alert.alertType.name : 'Alert';

  // Process publicPost with API-specific fields
  const publicPost = alert.publicPost || null;
  let publicPostTimestampFormatted = null;
  let publicPostChannelsFormatted = null;

  if (publicPost) {
    // Pulse API includes timestamp in publicPost
    if (publicPost.timestamp) {
      publicPostTimestampFormatted = formatTimestampValue(publicPost.timestamp, timezone);
    }
    // Pulse API includes channels array in publicPost
    if (
      publicPost.channels &&
      Array.isArray(publicPost.channels) &&
      publicPost.channels.length > 0
    ) {
      publicPostChannelsFormatted = publicPost.channels.join(', ');
    }
  }

  const processed = {
    alertId: alert.alertId || '',
    alertType: alertTypeName,
    alertTypeNormalized: normalizeAlertTypeValue(alertTypeName),
    alertTimestamp: alert.alertTimestamp || '',
    alertTimestampFormatted: formatTimestampValue(alert.alertTimestamp, timezone),
    headline: alert.headline || 'No headline available',
    dataminrAlertUrl: alert.dataminrAlertUrl || null,
    estimatedEventLocation: alert.estimatedEventLocation || null,
    subHeadline: alert.subHeadline || null,
    publicPost: publicPost,
    publicPostTimestampFormatted: publicPostTimestampFormatted,
    publicPostChannelsFormatted: publicPostChannelsFormatted,
    alertReferenceTerms: processReferenceTerms(alert),
    listsMatched: alert.listsMatched || null,
    listsMatchedFormatted: alert.listsMatched
      ? formatListsMatchedValue(alert.listsMatched)
      : '',
    // Pulse API specific fields (will be null for First Alert API)
    alertCompanies: alert.alertCompanies || null,
    alertCompaniesFormatted: alert.alertCompanies
      ? formatCompaniesValue(alert.alertCompanies)
      : '',
    alertSectors: alert.alertSectors || null,
    alertSectorsFormatted: alert.alertSectors
      ? formatSectorsValue(alert.alertSectors)
      : '',
    alertTopics: alert.alertTopics || null,
    alertTopicsFormatted: alert.alertTopics ? formatTopicsValue(alert.alertTopics) : '',
    metadata: processMetadata(alert),
    trialAlert: TRIAL_MODE
  };

  // Process live brief
  const liveBriefData = processLiveBrief(alert, timezone);
  if (liveBriefData) {
    processed.liveBrief = liveBriefData.liveBrief;
    processed.liveBriefCopyText = liveBriefData.liveBriefCopyText;
  }

  // Process intel agents (Pulse API specific)
  const intelAgentsData = processIntelAgents(alert);
  if (intelAgentsData) {
    if (intelAgentsData.intelAgentsGrouped) {
      processed.intelAgentsGrouped = intelAgentsData.intelAgentsGrouped;
      processed.intelAgentsCopyText = intelAgentsData.intelAgentsCopyText;
    }
    if (intelAgentsData.discoveredEntities) {
      processed.discoveredEntities = intelAgentsData.discoveredEntities;
    }
  }

  processed.hasAIContent = !!(processed.liveBrief || processed.intelAgentsGrouped);

  // Process public post media (handles both API formats)
  const mediaData = processMedia(alert);
  if (mediaData) {
    processed.mediaByType = mediaData;
  }

  // Process linked alerts - currently disabled as the API is not fully implemented
  processed.linkedAlerts = null;
  /*   
  const linkedAlertsData = await processLinkedAlerts(alert, options, timezone);
  if (linkedAlertsData) {
    processed.linkedAlerts = linkedAlertsData;
  }
  */

  return processed;
}

/**
 * Render alert detail template with alert data
 * @param {Object} alert - Alert object
 * @param {Object} options - Options object
 * @returns {Promise<string>} Rendered HTML string
 */
async function renderAlertDetail(alert, options) {
  const template = loadTemplate();
  const processedData = await processAlertData(alert, options);

  if (!processedData) {
    return '';
  }

  // Format as {details: {alerts: [alert]}} to match block.hbs structure
  // Preprocess the container class name
  return template({ details: { alerts: [processedData] } });
}

/**
 * Render alert notification template
 * @param {string} name - Integration name to display
 * @returns {string} Rendered HTML string
 */
function renderAlertNotification(name) {
  const template = loadNotificationTemplate();
  const displayName = name || 'Dataminr Alerts';
  return template({ name: displayName });
}

module.exports = {
  renderAlertDetail,
  renderAlertNotification,
  processAlertData
};
