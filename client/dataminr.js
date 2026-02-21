'use strict';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Array.at() polyfill for older browsers
 */
if (!Array.prototype.at) {
  Array.prototype.at = function (index) {
    // Convert negative index to positive
    if (index < 0) {
      index = this.length + index;
    }
    // Return undefined for out-of-bounds indices
    if (index < 0 || index >= this.length) {
      return undefined;
    }
    return this[index];
  };
}

/**
 * Check if a value is an array
 * @param {*} value - Value to check
 * @returns {boolean} True if value is an array
 */
function isArray(value) {
  return Array.isArray(value);
}

/**
 * Get element by ID with null safety
 * @param {string} id - Element ID
 * @returns {Element|null} The element or null if not found
 */
function byId(id) {
  return document.getElementById(id);
}

/**
 * Get the notification overlay left column scroll container element
 * @returns {Element|undefined} The notification container element or undefined if not found
 */
function getNotificationScrollContainer() {
  // First try getting the container for the new 2-column layout 
  let container = byId('notification-overlay-left-column-scroll-container');
  
  if(!container) {
    // If the container doesn't exist, get the older single column layout container as a fallback
    container = byId('notification-overlay-scroll-container');
  }
  
  return container;
}

/**
 * Query selector with null safety
 * @param {string} selector - CSS selector
 * @param {Element} root - Root element (optional)
 * @returns {Element|null} The element or null if not found
 */
function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * Query selector all helper
 * @param {string} sel - CSS selector
 * @param {Element} root - Root element to search in
 * @returns {Array} Array of found elements
 */
function qsa(sel, root = document) {
  return Array.prototype.slice.call(root.querySelectorAll(sel));
}

/**
 * Escape HTML characters
 * @param {string} s - String to escape
 * @returns {string} HTML-escaped string
 */
function htmlEscape(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/[&<>"']/g, function (m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m];
  });
}

/**
 * Fallback copy text to clipboard for older browsers
 * @param {string} text - Text to copy
 * @returns {void}
 */
function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.position = 'fixed';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand('copy');
    if (!successful) {
      console.error('Fallback: Copy command failed');
    }
  } catch (err) {
    console.error('Fallback: Unable to copy', err);
  }
  document.body.removeChild(textArea);
}

// ============================================================================
// POLARITY UTILITIES CLASS
// ============================================================================

/**
 * Utility class for Polarity integration operations
 * Provides shared functionality for Ember service access and integration messaging
 */
class PolarityUtils {
  /**
   * Create a new PolarityUtils instance
   * @returns {void}
   */
  constructor() {
    this.integrationMessenger = null;
    this._settingsChangeCallbacks = new Map(); // Map name -> callback
    this._scrollbarModeCallbacks = new Map(); // Map name -> callback
    this._scrollbarModeObserverInitialized = false;
    this._scrollbarModeLast = null; // Last scrollbar mode state
    this._scrollbarModeElement = null; // Element used for scrollbar detection
    this._settingsChangeObserverInitialized = false;
    this._enterSettings = false;
  }

  /**
   * Get an Ember service by name
   * @param {string} serviceName - Name of the service to retrieve
   * @returns {Object|null} The service instance or null if not found
   */
  getEmberService(serviceName) {
    const appNamespace = Ember.Namespace.NAMESPACES.find(
      (ns) => ns instanceof Ember.Application
    );

    if (!appNamespace) {
      console.error('Ember application namespace not found');
      return null;
    }

    return appNamespace.__container__.lookup(`service:${serviceName}`);
  }

  /**
   * Get the search data service
   * @returns {Object|null} The search data service instance or null if not found
   */
  getSearchData() {
    return this.getEmberService('search-data');
  }

  /**
   * Get the current user
   * @returns {Object|null} The current user or null if not found
   */
  getCurrentUser() {
    const currentUserService = this.getEmberService('currentUser');
    return currentUserService ? currentUserService.get('user') : null;
  }

  /**
   * Get the integrations
   * @returns {Object|null} The integrations or null if not found
   */
  getIntegrations() {
    const integrationLoader = this.getEmberService('integration-loader');
    return integrationLoader ? integrationLoader.get('integrations') : null;
  }

  /**
   * Get an integration by ID
   * @param {string} integrationId - ID of the integration to retrieve
   * @returns {Object|null} The integration or null if not found
   */
  getIntegrationById(integrationId) {
    const integrations = this.getIntegrations();
    return integrations ? integrations[integrationId] : null;
  }

  /**
   * Get the notification list
   * @returns {Array|null} The notification list or null if not found
   */
  getNotificationList() {
    const notificationsData = this.getEmberService('notificationsData');
    return notificationsData ? notificationsData.getNotificationList() : null;
  }

  /**
   * Send a message to the integration backend
   * @param {Object} payload - The message payload
   * @param {string} payload.action - The action to perform
   * @param {string} integrationId - Optional integration ID (overrides instance integrationId)
   * @returns {Promise} Promise that resolves with the response
   */
  async sendIntegrationMessage(payload, integrationId) {
    if (!integrationId) {
      return Promise.reject(new Error('Integration ID not provided.'));
    }

    if (!this.integrationMessenger) {
      this.integrationMessenger = this.getEmberService('integration-messenger');
    }

    if (!this.integrationMessenger) {
      return Promise.reject(new Error('Integration messenger service not available'));
    }

    // Validate payload before sending
    if (!payload || !payload.action) {
      return Promise.reject(new Error('Invalid payload: action is required'));
    }

    const message = {
      data: {
        type: 'integration-messages',
        attributes: { payload: payload }
      }
    };

    return this.integrationMessenger
      .sendMessage(integrationId, message)
      .catch((error) => {
        this.handleIntegrationError(error, payload.action);
        return Promise.reject(error);
      });
  }

  /**
   * Handle integration errors with appropriate logging
   * @param {Error} error - The error that occurred
   * @param {string} action - The action that failed
   */
  handleIntegrationError(error, action) {
    if (error.status === 422) {
      console.error('Unprocessable Content error:', {
        action: action,
        error: error.response ? error.response : error.message
      });
    } else {
      console.error(`Error sending integration message for action ${action}:`, error);
    }
  }

  /**
   * Track scrollbar mode changes
   * @param {Function} callback - Callback function to trigger on changes
   * @param {string} name - Unique name identifier for this callback (prevents duplicates from same class)
   * @returns {void}
   */
  trackScrollbarMode(callback, name) {
    if (typeof callback !== 'function' || !name) {
      console.error(
        'Invalid callback or name provided to PolarityUtils.trackScrollbarMode'
      );
      return;
    }

    // Store the callback by name (will override if name already exists)
    this._scrollbarModeCallbacks.set(name, callback);

    if (this._scrollbarModeObserverInitialized) {
      // If observer is already initialized, call the callback immediately with current state
      if (this._scrollbarModeLast !== null) {
        callback(this._scrollbarModeLast);
      }
      return;
    }

    this._scrollbarModeElement = document.createElement('div');
    this._scrollbarModeElement.style.cssText =
      'width:100px;height:100px;overflow:scroll;position:absolute;top:-9999px;';
    document.body.appendChild(this._scrollbarModeElement);

    const check = () => {
      const oldValue = this._scrollbarModeLast;
      const newValue = this.getOverlayScrollbarState();
      if (oldValue !== newValue) {
        // Call all registered callbacks
        this._scrollbarModeCallbacks.forEach((cb) => cb(newValue));
      }
    };

    new ResizeObserver(check).observe(this._scrollbarModeElement);
    ['resize', 'orientationchange', 'visibilitychange', 'pageshow'].forEach((ev) =>
      window.addEventListener(ev, check, { passive: true })
    );

    this._scrollbarModeObserverInitialized = true;
    check(); // initial detection
  }

  /**
   * Check if overlay scrollbars are enabled
   * @returns {boolean} True if overlay scrollbars are enabled, false otherwise
   */
  getOverlayScrollbarState() {
    // If observer is initialized, use the stored element (which is already in the DOM)
    if (this._scrollbarModeObserverInitialized && this._scrollbarModeElement) {
      const el = this._scrollbarModeElement;

      // Force layout flush – this makes offsetWidth/clientWidth update correctly
      el.style.display = 'none';
      el.offsetHeight; // <-- force reflow (read a layout property)
      el.style.display = '';

      const overlay = el.offsetWidth === el.clientWidth;
      if (overlay !== this._scrollbarModeLast) {
        this._scrollbarModeLast = overlay;
      }

      return overlay;
    }

    // If observer hasn't been initialized, perform a one-time check with temporary element
    const tempEl = document.createElement('div');
    tempEl.style.cssText =
      'width:100px;height:100px;overflow:scroll;position:absolute;top:-9999px;';
    document.body.appendChild(tempEl);

    // Force layout flush – this makes offsetWidth/clientWidth update correctly
    tempEl.style.display = 'none';
    tempEl.offsetHeight; // <-- force reflow (read a layout property)
    tempEl.style.display = '';

    const overlay = tempEl.offsetWidth === tempEl.clientWidth;
    document.body.removeChild(tempEl);

    // Cache the result if not already cached
    if (this._scrollbarModeLast === null) {
      this._scrollbarModeLast = overlay;
    }

    return overlay;
  }

  /**
   * Setup observer for settings window changes - hacky but more reliable for web/client than the global function
   * @param {Function} callback - Callback function to trigger on changes - enterSettings (true/false)
   * @param {string} name - Unique name identifier for this callback (prevents duplicates from same class)
   * @returns {void}
   */
  onSettingsChange(callback, name) {
    if (typeof callback !== 'function' || !name) {
      console.error(
        'Invalid callback or name provided to PolarityUtils.onSettingsChange'
      );
      return;
    }

    // Store the callback by name (will override if name already exists)
    this._settingsChangeCallbacks.set(name, callback);

    if (this._settingsChangeObserverInitialized) return;

    const markRemovedFlag = async (mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];

        // Detect removals - entering settings
        if (mutation.removedNodes && mutation.removedNodes.length > 0) {
          for (let r = 0; r < mutation.removedNodes.length; r++) {
            const removed = mutation.removedNodes[r];
            if (removed.nodeType === 1) {
              if (
                (removed.id && removed.id === 'notification-window') ||
                (removed.querySelector && removed.querySelector('#search-query'))
              ) {
                this._enterSettings = true;
                this._settingsChangeCallbacks.forEach((cb) => cb(this._enterSettings));
                return;
              }
            }
          }
        }

        // Detect additions - exiting settings
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          for (let a = 0; a < mutation.addedNodes.length; a++) {
            const added = mutation.addedNodes[a];
            if (added.nodeType === 1) {
              const isNotificationWindow =
                (added.id && added.id === 'notification-window') ||
                (added.querySelector && added.querySelector('#search-query'));
              if (isNotificationWindow && this._enterSettings) {
                this._enterSettings = false;
                this._settingsChangeCallbacks.forEach((cb) => cb(this._enterSettings));
                return;
              }
            }
          }
        }
      }
    };

    const attachObserverToContainer = (container) => {
      try {
        const observer = new MutationObserver(markRemovedFlag);
        observer.observe(container, { childList: true, subtree: true });
        this._settingsChangeObserverInitialized = true;
      } catch (e) {
        // Silently ignore observer errors
      }
    };

    const container = document.getElementsByClassName('liquid-container')[0];
    if (container) {
      attachObserverToContainer(container);
    }
  }
}

/**
 * Dataminr integration class
 * @param {Object} integration - The integration object
 * @param {Object} userConfig - User configuration object
 * @param {boolean} userConfig.subscribed - Whether user is subscribed to alerts
 * @param {Object} userOptions - User options object
 */
class DataminrIntegration {
  /**
   * Create a new DataminrIntegration instance
   * @param {Object} integration - The integration object
   * @param {Object} userConfig - User configuration object
   * @param {Object} userOptions - User options object
   */
  constructor(integration, userConfig, userOptions) {
    this.integration = integration;
    this.integrationId = integration.type;
    this.userConfig = userConfig;
    this.userOptions = userOptions;
    this.pollingInterval = null;
    this.pollIntervalMs = 60000; // Poll Polarity server every 60 seconds
    this.isPollingInProgress = false;
    this.currentUser = null;
    this.currentAlertIds = new Map(); // Map of alertId -> { id, headline, type, alertTimestamp }
    this.lastAlertTimestamp = null; // ISO timestamp of last alert
    this.maxVisibleTags = 10; // Maximum number of visible alert tags to display
    this.currentFilter = null; // Current alert type filter: null (all), 'Flash', 'Urgent', or 'Alert'
    this.utils = new PolarityUtils();

    // Initialize the application
    this.init();
  }

  /**
   * Send a message to the integration backend
   * @param {Object} payload - The message payload
   * @param {string} payload.action - The action to perform
   * @returns {Promise} Promise that resolves with the response
   */
  async sendIntegrationMessage(payload) {
    if (this.utils) {
      return this.utils.sendIntegrationMessage(payload, this.integrationId);
    }
    return Promise.reject(new Error('PolarityUtils not available'));
  }

  /**
   * Build a class name with polarity-x-client and dm-jewel-theme classes if applicable
   * @private
   * @param {string} baseClassName - The base class name
   * @returns {string} The complete class name with conditional classes added
   */
  buildClassName(baseClassName) {
    let className = baseClassName;

    if (window.polarity) {
      className += ' polarity-x-client';
    }

    const hasJewelTheme =
      document.body &&
      document.body.classList &&
      document.body.classList.contains('dm-jewel-theme');
    if (hasJewelTheme) {
      className += ' dm-jewel-theme';
    }

    const overlay = this.utils.getOverlayScrollbarState();
    if (overlay) {
      className += ' overlay-scrollbars';
    }

    return className;
  }

  /**
   * Initialize the Dataminr integration
   * @private
   */
  async initPolarityPin() {
    const notificationContainer = getNotificationScrollContainer();
    
    if (notificationContainer) {
      const hasJewelTheme =
        document.body &&
        document.body.classList &&
        document.body.classList.contains('dm-jewel-theme');
      if (!hasJewelTheme) {
        notificationContainer.style.height = '100%';
        notificationContainer.style.display = 'block';
      }
      
      // Add pinned polarity container div before notificationContainer
      let pinnedPolarityContainer = byId('polarity-pin-container');
      if (!pinnedPolarityContainer) {
        pinnedPolarityContainer = document.createElement('div');
        pinnedPolarityContainer.id = 'polarity-pin-container';
        notificationContainer.parentNode.insertBefore(
          pinnedPolarityContainer,
          notificationContainer
        );
      }

      // Add dataminr class div before dataminr container
      const dataminrIntegrationClass = document.createElement('div');
      dataminrIntegrationClass.className = `${this.integrationId}-integration`;
      const dataminrContainer = document.createElement('div');
      dataminrContainer.className = this.buildClassName('dataminr-container');

      // Load notification HTML from backend template
      try {
        const result = await this.sendIntegrationMessage({
          action: 'renderAlertNotification',
          name: htmlEscape(this.userConfig.name)
        });

        dataminrContainer.innerHTML = result.html || '';
      } catch (error) {
        console.error('Error rendering alert notification template:', error);
        // Fallback to empty content if template rendering fails
        dataminrContainer.innerHTML =
          '<div class="dataminr-content"><div class="dataminr-header"><div class="dataminr-header-left"><span class="dataminr-notification-header-title">' +
          `${htmlEscape(this.userConfig.name)}` +
          '</span></div></div><div class="dataminr-body"></div></div>';
      }
      dataminrIntegrationClass.appendChild(dataminrContainer);
      pinnedPolarityContainer.appendChild(dataminrIntegrationClass);

      const borderTopClass = window.polarity
        ? '.dataminr-container'
        : '.dataminr-content';
      const contentContainer = qsa(borderTopClass, pinnedPolarityContainer);

      if (contentContainer.length > 1) {
        for (const content of contentContainer.slice(1)) {
          content.classList.add('dataminr-no-top-border');
        }
      }

      // Add click handler to toggle body visibility - entire header is clickable
      const headerElement = dataminrContainer.querySelector('.dataminr-header');
      const bodyElement = dataminrContainer.querySelector('.dataminr-body');
      const chevronIcon = dataminrContainer.querySelector('.dataminr-chevron-icon');
      const clearAllButton = dataminrContainer.querySelector(
        '.dataminr-clear-all-alerts-btn'
      );

      if (headerElement && bodyElement && chevronIcon) {
        headerElement.addEventListener('click', (e) => {
          // Don't toggle if clicking the clear button
          if (e.target === clearAllButton || clearAllButton.contains(e.target)) {
            return;
          }
          const isHidden = bodyElement.style.display === 'none';
          bodyElement.style.display = isHidden ? 'block' : 'none';
          chevronIcon.style.transform = isHidden ? 'rotate(-180deg)' : 'rotate(0deg)';

          // If closing the body, hide details and deselect active alert
          if (!isHidden) {
            this.hideAllDetails();
            this.deactivateAllTagButtons();
          }
        });
      }

      // Add click handler for clear all alerts button
      if (clearAllButton) {
        clearAllButton.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent header toggle
          this.clearAllAlerts();
        });
      }

      // Add click handler for restart polling button
      const restartPollingButton = dataminrContainer.querySelector(
        '.dataminr-restart-polling-btn'
      );
      if (restartPollingButton) {
        restartPollingButton.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent header toggle
          this.restartPolling();
        });
      }

      // Set up event delegation for alert type filter buttons
      const alertIconsContainer = dataminrContainer.querySelector(
        '.dataminr-alert-icons-container'
      );
      if (alertIconsContainer) {
        alertIconsContainer.addEventListener('click', (e) => {
          const icon = e.target.closest('.dataminr-alert-icon');
          if (icon) {
            e.stopPropagation(); // Prevent header toggle
            // Don't allow filtering if count is 0 or icon is hidden
            if (icon.style.display === 'none' || parseInt(icon.textContent, 10) === 0) {
              return;
            }
            const alertType = icon.getAttribute('data-alert-type');
            if (alertType) {
              this.filterAlertsByType(alertType);
            }
          }
        });
      }
    }
  }

  /**
   * Watch a tracked map
   * @param {Map} map - The map to watch
   * @param {Function} onChange - The function to call when the map changes
   * @returns {Map} The map
   */
  watchTrackedMap(map, onChange) {
    ['set', 'delete', 'clear'].forEach((method) => {
      const orig = map[method].bind(map);
      map[method] = (...args) => {
        const before = map.size;
        const result = orig(...args);
        const after = map.size;
        if (after !== before) {
          onChange({ op: method, before, after, args });
        }
        return result;
      };
    });
    return map;
  }

  /**
   * Copy text to clipboard with fallback
   * @private
   * @param {string} textToCopy - Text to copy to clipboard
   * @param {string} logMessage - Message to log on success
   */
  copyToClipboard(textToCopy, logMessage) {
    if (!textToCopy) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(textToCopy)
        .then(function () {
          console.log(logMessage);
        })
        .catch(function (err) {
          console.error('Failed to copy:', err);
          fallbackCopyTextToClipboard(textToCopy);
        });
    } else {
      fallbackCopyTextToClipboard(textToCopy);
    }
  }

  /**
   * Submit metadata values sequentially as separate search queries to Polarity
   * @param {Array<string>} values - Array of metadata values to search
   * @private
   */
  submitMetadataSearchesSequentially(values) {
    if (!values || values.length === 0) return;

    const self = this;
    let currentIndex = 0;

    const submitNext = function () {
      if (currentIndex >= values.length) {
        // All searches submitted, clear the input
        self.clearSearchInput();
        return;
      }

      const value = values[currentIndex];
      self.submitMetadataSearch(value);
      currentIndex++;

      // Submit next value after a short delay
      if (currentIndex < values.length) {
        setTimeout(submitNext, 200);
      } else {
        // Last search, clear input after a delay
        setTimeout(function () {
          self.clearSearchInput();
        }, 200);
      }
    };

    // Start submitting
    submitNext();
  }

  /**
   * Clear the search input field
   * @private
   */
  clearSearchInput() {
    let searchInput = null;
    if (window.polarity) {
      searchInput = qs('[data-test-target="notifications-search-bar-input"]');
    } else {
      searchInput = byId('search-query');
    }

    if (searchInput) {
      searchInput.value = '';
      // Trigger input event to notify any listeners that the value changed
      const inputEvent = new Event('input', { bubbles: true });
      searchInput.dispatchEvent(inputEvent);
      // Unfocus the input field
      searchInput.blur();
    }
  }

  /**
   * Submit a single metadata value as a search query to Polarity
   * @param {string} entityName - The search query string
   * @private
   */
  submitMetadataSearch(entityName) {
    if (!entityName) return;

    let searchInput = null;
    if (window.polarity) {
      searchInput = qs('[data-test-target="notifications-search-bar-input"]');
    } else {
      searchInput = byId('search-query');
    }

    if (searchInput) {
      searchInput.value = entityName;
      // Trigger input event to notify any listeners that the value changed
      const inputEvent = new Event('input', { bubbles: true });
      searchInput.dispatchEvent(inputEvent);

      // Try clicking the search button
      let searchButton = null;
      if (window.polarity) {
        searchButton = qs('[data-test-target="notifications-search-bar-btn"]');
      } else {
        searchButton = qs('[data-test-target="search-button"]');
      }

      if (searchButton) {
        // Enable the button if it's disabled
        if (searchButton.disabled) {
          searchButton.disabled = false;
        }
        if (searchButton.classList.contains('disabled')) {
          searchButton.classList.remove('disabled');
        }
        searchButton.click();
      }
    }
  }

  /**
   * Poll backend for new alerts since last query timestamp
   * @private
   */
  async pollAlerts() {
    if (this.isPollingInProgress) return;
    this.isPollingInProgress = true;
    try {
      // Fetch new alerts since last query timestamp
      const newAlerts = await this.getAlerts();

      // Add new alerts to current alerts map
      if (newAlerts.length > 0) {
        newAlerts.forEach((newAlert) => {
          this.processNewAlert(newAlert, true);
        });

        // Update the display with new alerts
        this.updateAlertsDisplay(Array.from(this.currentAlertIds.values()));
      }
    } catch (error) {
      console.error('Error polling alerts:', error);

      // Check if error is a 404 - integration has stopped
      // Handle different error formats: error.status, error.response.status, or error.statusCode
      const statusCode =
        error.status ||
        (error.response && error.response.status) ||
        error.statusCode ||
        (error.detail && error.detail.status);
      if (statusCode === 404) {
        // Stop polling and show error message
        this.stopPolling();
        this.showPollingError();
      }
    }
    this.isPollingInProgress = false;
  }

  /**
   * Get full alerts list from backend
   * @private
   * @param {number} [count] - Optional number of alerts to request (for initial query)
   * @returns {Promise<Array>} Array of alert objects
   */
  async getAlerts(count) {
    try {
      // Build payload with timestamp and optional count
      const payload = {
        action: 'getAlerts'
      };

      // If count is provided (from URL parameter), include it (overrides timestamp)
      if (count) {
        payload.count = count;
      } else if (this.lastAlertTimestamp) {
        // Otherwise, send the last query timestamp to get alerts since then
        payload.sinceTimestamp = this.lastAlertTimestamp;
      } else {
        // First query: send current timestamp (will return empty array)
        payload.sinceTimestamp = new Date().toISOString();
      }

      const result = await this.sendIntegrationMessage(payload);

      // Update last query timestamp from response
      if (result && result.lastAlertTimestamp) {
        this.lastAlertTimestamp = result.lastAlertTimestamp;
      } else if (result && result.alerts && result.alerts.length > 0) {
        // If no timestamp in response, use the most recent alert's timestamp
        const mostRecentAlert = result.alerts[0];
        if (mostRecentAlert && mostRecentAlert.alertTimestamp) {
          this.lastAlertTimestamp = mostRecentAlert.alertTimestamp;
        }
      } else if (!this.lastAlertTimestamp) {
        // First query with no alerts: set timestamp to now
        this.lastAlertTimestamp = new Date().toISOString();
      }

      if (result && result.alerts) {
        return result.alerts;
      }
      return [];
    } catch (error) {
      console.error('Error getting alerts:', error);
      // Re-throw error so pollAlerts can handle 404s
      throw error;
    }
  }

  /**
   * Clear all alerts from the UI and reset state
   * @private
   */
  clearAllAlerts() {
    // Clear the alerts maps
    if (this.currentAlertIds) {
      this.currentAlertIds.clear();
    }

    // Reset the last query timestamp
    this.lastAlertTimestamp = null;

    // Update alert count to 0
    this.updateAlertCount(0);

    // Clear the display
    this.updateAlertsDisplay([]);

    // Hide all details
    this.hideAllDetails();
  }

  /**
   * Normalize alert type for CSS class
   * @private
   * @param {string} alertType - Alert type name
   * @returns {string} Normalized alert type
   */
  normalizeAlertType(alertType) {
    return alertType.toLowerCase().replace('update', '').trim();
  }

  /**
   * Get alert type from alert object
   * @private
   * @param {Object} alert - Alert object
   * @returns {string} Alert type name
   */
  getAlertType(alert) {
    return alert.alertType && alert.alertType.name ? alert.alertType.name : 'Alert';
  }

  /**
   * Get alert headline from alert object
   * @private
   * @param {Object} alert - Alert object
   * @returns {string} Alert headline
   */
  getAlertHeadline(alert) {
    return alert.headline || 'No headline available';
  }

  /**
   * Hide all alert detail containers across all integration instances
   * @private
   */
  hideAllDetails() {
    const allDetails = qsa('#dataminr-details-container .dataminr-alert-detail');
    allDetails.forEach((detail) => {
      detail.style.display = 'none';
      detail.classList.remove('visible');
    });
  }

  /**
   * Remove active class from all tag buttons across all integration instances
   * @private
   */
  deactivateAllTagButtons() {
    const allTagButtons = qsa('.dataminr-tag');
    allTagButtons.forEach((btn) => {
      btn.classList.remove('active');
    });
  }

  /**
   * Show a specific alert detail container
   * @private
   * @param {string} alertId - Alert ID to show
   */
  async showDetail(alertId) {
    if (alertId && alertId !== 'remaining') {
      let detailContainer = qs(`.dataminr-alert-detail[data-alert-id="${alertId}"]`);

      // If detail container doesn't exist, create it dynamically
      if (!detailContainer) {
        // Get or create the details container
        const dataminrDetailsContainer = this.getDataminrDetailsContainerForIntegration();

        let detailsContainer = dataminrDetailsContainer.querySelector(
          '.dataminr-alert-details'
        );
        if (!detailsContainer) {
          detailsContainer = document.createElement('div');
          detailsContainer.className = this.buildClassName('dataminr-alert-details');
          dataminrDetailsContainer.appendChild(detailsContainer);
        }

        // Create and add the detail element with loading state
        detailContainer = document.createElement('div');
        detailContainer.className = 'dataminr-alert-detail';
        detailContainer.setAttribute('data-alert-id', alertId);
        detailContainer.innerHTML = '<div style="padding: 20px; text-align: center;">Loading alert details...</div>';
        detailsContainer.appendChild(detailContainer);

        // Show it immediately in loading state
        this.hideAllDetails();
        detailContainer.style.display = 'block';
        detailContainer.classList.add('visible');

        // Scroll notification overlay to top when alert is selected
        const notificationContainer = getNotificationScrollContainer();
        if (notificationContainer) {
          notificationContainer.scrollTop = 0;
        }

        // Build detail HTML asynchronously (backend will fetch alert from its cache)
        const detailHtml = await this.buildAlertDetailHtml(alertId);

        // If no HTML returned, alert might not exist
        if (!detailHtml) {
          detailContainer.innerHTML = '<div style="padding: 20px; text-align: center;">Alert details have expired.</div>';
          return;
        }

        // Extract only the dataminr-alert-detail-content element to avoid extra containers from block.hbs
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = detailHtml;
        const contentElement = tempDiv.querySelector('.dataminr-alert-detail');
        detailContainer.innerHTML = contentElement
          ? contentElement.innerHTML
          : detailHtml;

        // Add click handler for close icon
        const closeIcon = detailContainer.querySelector('.dataminr-alert-close-icon');
        if (closeIcon) {
          closeIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            const closeAlertId = closeIcon.getAttribute('data-alert-id');
            if (closeAlertId) {
              this.markAlertAsRead(closeAlertId);
            }
          });
        }
      } else {
        // Container already exists, just show it
        this.hideAllDetails();
        detailContainer.style.display = 'block';
        detailContainer.classList.add('visible');

        // Scroll notification overlay to top when alert is selected
        const notificationContainer = getNotificationScrollContainer();
        if (notificationContainer) {
          notificationContainer.scrollTop = 0;
        }
      }
    }
  }

  getDataminrDetailsContainerForIntegration() {
    let dataminrDetailsContainer = byId('dataminr-details-container');
    const dataminrDetailsClass = this.buildClassName('dataminr-alert-details');

    if (!dataminrDetailsContainer) {
      const listTopSentinel = byId('list-top-sentinel');
      if (!listTopSentinel) {
        return;
      }
      dataminrDetailsContainer = document.createElement('div');
      dataminrDetailsContainer.id = 'dataminr-details-container';
      dataminrDetailsContainer.className = `${this.integrationId}-integration`;
      const detailsContainer = document.createElement('div');
      detailsContainer.className = dataminrDetailsClass;
      dataminrDetailsContainer.appendChild(detailsContainer);
      listTopSentinel.parentNode.insertBefore(dataminrDetailsContainer, listTopSentinel);
    } else if (
      !dataminrDetailsContainer.classList.contains(`${this.integrationId}-integration`)
    ) {
      dataminrDetailsContainer.classList.add(`${this.integrationId}-integration`);
    }
    return dataminrDetailsContainer;
  }

  /**
   * Handle alert tag button click to toggle detail visibility
   * @private
   * @param {string} alertId - Alert ID from the clicked button
   * @param {Element} button - The clicked button element
   */
  handleAlertTagClick(alertId, button) {
    const isActive = button.classList.contains('active');

    if (isActive) {
      button.classList.remove('active');
      this.hideAllDetails();
      return;
    }

    this.deactivateAllTagButtons();
    button.classList.add('active');
    this.showDetail(alertId);
  }

  /**
   * Get count of visible tag buttons (excluding remaining button)
   * @private
   * @returns {number} Count of visible tag buttons
   */
  getVisibleTagButtonCount() {
    const integrationContainer = this.getIntegrationContainer();
    if (!integrationContainer) return 0;
    return qsa(
      '.dataminr-tag[data-alert-id]:not([data-alert-id="remaining"])',
      integrationContainer
    ).length;
  }

  /**
   * Update remaining button display and count
   * @private
   */
  updateRemainingButton() {
    const integrationContainer = this.getIntegrationContainer();
    if (!integrationContainer) return;
    const remainingButton = qs(
      '.dataminr-tag[data-alert-id="remaining"]',
      integrationContainer
    );
    const remainingCountElement = qs('#dataminr-remaining-count', integrationContainer);

    if (!this.currentAlertIds || this.currentAlertIds.size === 0) {
      if (remainingButton) {
        remainingButton.remove();
      }
      return;
    }

    const visibleCount = this.getVisibleTagButtonCount();
    const remainingCount = this.currentAlertIds.size - visibleCount;

    if (remainingCount > 0) {
      if (remainingButton && remainingCountElement) {
        remainingCountElement.textContent = '+' + remainingCount;
        remainingButton.style.display = 'block';
      } else if (!remainingButton) {
        // Create remaining button if it doesn't exist
        const alertsList = qs('.dataminr-alerts-list', integrationContainer);
        if (alertsList) {
          const newRemainingButton = document.createElement('button');
          newRemainingButton.className = 'dataminr-tag dataminr-tag-alert';
          newRemainingButton.setAttribute('data-alert-id', 'remaining');
          newRemainingButton.innerHTML = `
            <div class="dataminr-alert-tag-text">
              <span class="dataminr-tag-acronym">${htmlEscape(
                this.userConfig.acronym
              )}</span> 
              <span id="dataminr-remaining-count" class="dataminr-tag-headline">+${remainingCount}</span>
            </div>
          `;
          // Note: Click handler managed by setupAlertTagDelegation() - no individual listener needed
          alertsList.appendChild(newRemainingButton);
        }
      }
    } else {
      if (remainingButton) {
        remainingButton.remove();
      }
    }
  }

  /**
   * Add a single alert tag button to the UI
   * @private
   * @param {Object} alert - Alert object to add
   * @param {string} alertId - Alert ID
   */
  addSingleAlertToUI(alert, alertId) {
    const integrationContainer = this.getIntegrationContainer();
    if (!integrationContainer) return;
    const bodyElement = qs('.dataminr-body', integrationContainer);
    if (!bodyElement) return;

    const alertsListContainer = qs('.dataminr-alerts-list', integrationContainer);
    if (!alertsListContainer) return;

    // Build and add tag button
    const alertType = this.getAlertType(alert);
    const headline = this.getAlertHeadline(alert);
    const alertClass = 'dataminr-tag-' + this.normalizeAlertType(alertType);

    const tagButton = document.createElement('button');
    tagButton.className = `dataminr-tag ${alertClass}`;
    tagButton.setAttribute('data-alert-id', alertId);
    tagButton.setAttribute('title', headline);
    tagButton.innerHTML = `
      <div class="dataminr-alert-tag-text">
        <span class="dataminr-tag-acronym">${htmlEscape(this.userConfig.acronym)}</span> 
        <span class="dataminr-tag-headline">${htmlEscape(headline)}</span>
      </div>
    `;

    // Insert before remaining button if it exists, otherwise append
    const remainingButton = qs(
      '.dataminr-tag[data-alert-id="remaining"]',
      integrationContainer
    );
    if (remainingButton) {
      alertsListContainer.insertBefore(tagButton, remainingButton);
    } else {
      alertsListContainer.appendChild(tagButton);
    }

    // Note: Click handler managed by setupAlertTagDelegation() - no individual listener needed
  }

  /**
   * Mark a single alert as read and remove it from UI
   * @private
   * @param {string} alertId - Alert ID to mark as read
   */
  async markAlertAsRead(alertId) {
    if (!alertId) {
      console.warn('No alertId provided to markAlertAsRead');
      return;
    }

    try {
      // Remove alert from current alerts maps
      if (this.currentAlertIds) {
        this.currentAlertIds.delete(alertId);
      }

      // Remove tag button from UI
      const integrationContainer = this.getIntegrationContainer();
      if (!integrationContainer) return;
      const tagButton = qs(
        `.dataminr-tag[data-alert-id="${alertId}"]`,
        integrationContainer
      );
      if (tagButton) {
        tagButton.remove();
      }

      // Remove detail container from UI
      const dataminrDetailsContainer = this.getDataminrDetailsContainerForIntegration();
      if (dataminrDetailsContainer) {
        const detailContainer = qs(
          `.dataminr-alert-detail[data-alert-id="${alertId}"]`,
          dataminrDetailsContainer
        );
        if (detailContainer) {
          // Hide entity details before removing the container
          this.hideEntityDetails(detailContainer);
          detailContainer.remove();
        }
      }

      // Get all alerts that aren't currently displayed
      const visibleTagButtons = qsa(
        '.dataminr-tag[data-alert-id]:not([data-alert-id="remaining"])',
        integrationContainer
      );
      const displayedAlertIds = new Set();
      visibleTagButtons.forEach((btn) => {
        const id = btn.getAttribute('data-alert-id');
        if (id && id !== 'remaining') {
          displayedAlertIds.add(id);
        }
      });

      // Find alerts that aren't displayed yet
      const availableAlerts = Array.from(this.currentAlertIds.values()).filter(
        (alert) => {
          const id = alert.alertId || '';
          return id && !displayedAlertIds.has(id);
        }
      );

      // Add next alert(s) up to maxVisibleTags visible tags
      const visibleCount = visibleTagButtons.length;
      const alertsToAdd = Math.min(
        this.maxVisibleTags - visibleCount,
        availableAlerts.length
      );
      for (let i = 0; i < alertsToAdd; i++) {
        const alert = availableAlerts[i];
        if (alert) {
          const alertId = alert.alertId || 'alert-' + i;
          this.addSingleAlertToUI(alert, alertId);
        }
      }

      // Update remaining button
      this.updateRemainingButton();

      // Update alert count
      const newCount = this.currentAlertIds ? this.currentAlertIds.size : 0;
      this.updateAlertCount(newCount);

      // If no alerts remain, clear the display
      if (newCount === 0) {
        const bodyElement = qs('.dataminr-body', integrationContainer);
        if (bodyElement) {
          bodyElement.innerHTML = '';
        }
      }
    } catch (error) {
      console.error('Error marking alert as read:', error);
    }
  }

  /**
   * Calculate alert counts by type
   * @private
   * @returns {Object} Object with counts for each alert type
   * @returns {number} returns.flash - Count of Flash alerts
   * @returns {number} returns.urgent - Count of Urgent alerts
   * @returns {number} returns.alert - Count of Alert alerts
   * @returns {number} returns.total - Total count of all alerts
   */
  calculateAlertCountsByType() {
    if (!this.currentAlertIds || this.currentAlertIds.size === 0) {
      return { flash: 0, urgent: 0, alert: 0, total: 0 };
    }

    const counts = { flash: 0, urgent: 0, alert: 0, total: 0 };

    this.currentAlertIds.forEach((alert) => {
      const alertType = this.getAlertType(alert);
      const normalizedType = alertType ? alertType.toLowerCase() : 'alert';

      if (normalizedType === 'flash') {
        counts.flash++;
      } else if (normalizedType === 'urgent') {
        counts.urgent++;
      } else {
        // Default to 'alert' for any other type or unknown types
        counts.alert++;
      }
      counts.total++;
    });

    return counts;
  }

  /**
   * Update alert counts in UI (by type: Flash, Urgent, Alert)
   * Shows icons for alert types that have counts > 0
   * @private
   * @param {number} [count] - Optional total count (if not provided, calculates from currentAlertIds)
   */
  updateAlertCount(count) {
    // Calculate counts by type
    const counts = this.calculateAlertCountsByType();
    const noneIcon = byId('dataminr-alert-icon-none');
    const totalCount = count !== undefined ? count : counts.total;
    if (noneIcon) {
      noneIcon.style.display = totalCount > 0 ? 'none' : 'inline-block';
    }

    const integrationContainer = this.getIntegrationContainer();
    if (!integrationContainer) return;

    // Update Flash count
    const flashIcon = qs('.dataminr-alert-icon-flash', integrationContainer);
    if (flashIcon) {
      flashIcon.textContent = counts.flash.toString();
      // Only show if it's the selected type to show or if there are alerts of this type
      const shouldShow = totalCount > 0 && counts.flash > 0;
      flashIcon.style.display = shouldShow ? 'inline-block' : 'none';
      // Make it clickable and update opacity based on filter
      flashIcon.style.cursor = 'pointer';
      flashIcon.style.opacity =
        this.currentFilter === null || this.currentFilter === 'Flash' ? '1' : '0.5';
    }

    // Update Urgent count
    const urgentIcon = qs('.dataminr-alert-icon-urgent', integrationContainer);
    if (urgentIcon) {
      urgentIcon.textContent = counts.urgent.toString();
      // Only show if it's the selected type to show or if there are alerts of this type
      const shouldShow = totalCount > 0 && counts.urgent > 0;
      urgentIcon.style.display = shouldShow ? 'inline-block' : 'none';
      // Make it clickable and update opacity based on filter
      urgentIcon.style.cursor = 'pointer';
      urgentIcon.style.opacity =
        this.currentFilter === null || this.currentFilter === 'Urgent' ? '1' : '0.5';
    }

    // Update Alert count
    const alertIcon = qs('.dataminr-alert-icon-alert', integrationContainer);
    if (alertIcon) {
      alertIcon.textContent = counts.alert.toString();
      // Only show if it's the selected type to show or if there are alerts of this type
      const shouldShow = totalCount > 0 && counts.alert > 0;
      alertIcon.style.display = shouldShow ? 'inline-block' : 'none';
      // Make it clickable and update opacity based on filter
      alertIcon.style.cursor = 'pointer';
      alertIcon.style.opacity =
        this.currentFilter === null || this.currentFilter === 'Alert' ? '1' : '0.5';
    }

    // Show/hide clear button based on total alert count
    const clearButton = qs('.dataminr-clear-all-alerts-btn', integrationContainer);
    if (clearButton) {
      clearButton.style.display = totalCount > 0 ? 'inline-block' : 'none';
    }

    // Add visual indicator if there are alerts
    const container = this.getDataminrContainerForIntegration();
    if (container) {
      if (totalCount > 0) {
        container.classList.add('dataminr-has-alerts');
      } else {
        container.classList.remove('dataminr-has-alerts');
      }
    }
  }

  /**
   * Get the integration container root element
   * @private
   * @returns {Element|null} The integration container root element or null if not found
   */
  getIntegrationContainer() {
    return qs(`.${this.integrationId}-integration`);
  }

  getDataminrContainerForIntegration() {
    const containers = qsa('.dataminr-container');
    if (containers) {
      for (const container of containers) {
        if (
          container.parentNode &&
          container.parentNode.classList.contains(`${this.integrationId}-integration`)
        ) {
          return container;
        }
      }
    }
    return null;
  }

  /**
   * Get the browser's timezone
   * @private
   * @returns {string|undefined} Timezone string (e.g., 'America/New_York') or undefined
   */
  getBrowserTimezone() {
    try {
      // Use Intl.DateTimeFormat().resolvedOptions() to get the IANA timezone name
      const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
      if (resolvedOptions && resolvedOptions.timeZone) {
        return resolvedOptions.timeZone;
      }
      return undefined;
    } catch (error) {
      console.error('Error getting browser timezone:', error);
      return undefined;
    }
  }

  /**
   * Build HTML for alert detail container using backend template
   * @private
   * @param {string} alertId - Alert ID
   * @returns {Promise<string>} HTML string for alert details
   */
  async buildAlertDetailHtml(alertId) {
    if (!alertId) return '';

    try {
      // Get browser timezone
      const timezone = this.getBrowserTimezone();

      // Request rendered HTML from backend (backend will fetch alert from its cache)
      const payload = {
        action: 'renderAlertDetail',
        alertId: alertId
      };

      // Add timezone to payload if available
      if (timezone) {
        payload.timezone = timezone;
      }

      const result = await this.sendIntegrationMessage(payload);
      return result.html || '';
    } catch (error) {
      console.error('Error rendering alert detail template:', error);
      // Fallback to empty string or error message
      return '<div class="dataminr-alert-detail-content"><p>Error loading alert details</p></div>';
    }
  }

  /**
   * Filter alerts by type and update display
   * @private
   * @param {string|null} alertType - Alert type to filter by ('Flash', 'Urgent', 'Alert'), or null for all
   */
  filterAlertsByType(alertType) {
    // Toggle filter: if clicking the same type, show all
    if (this.currentFilter === alertType) {
      this.currentFilter = null;
    } else {
      this.currentFilter = alertType;
    }

    // Update display with current alerts and filter
    this.updateAlertsDisplay(this.currentAlertIds, false);

    // Update button opacities
    this.updateAlertCount();
  }

  /**
   * Update alerts display in UI
   * @private
   * @param {Array|Map} alerts - Alerts to display
   * @param {boolean} showAll - Whether to show all alerts
   * @returns {Promise<void>}
   */
  async updateAlertsDisplay(alerts, showAll = false) {
    const integrationContainer = this.getIntegrationContainer();
    if (!integrationContainer) return;
    const bodyElement = qs('.dataminr-body', integrationContainer);
    if (!bodyElement) return;

    // Convert alerts array to Map if needed
    let alertsMap;
    if (Array.isArray(alerts)) {
      alertsMap = new Map();
      alerts.forEach((alert) => {
        const alertId = alert.alertId || 'alert-' + alerts.indexOf(alert);
        alertsMap.set(alertId, alert);
      });
    } else if (alerts instanceof Map) {
      alertsMap = alerts;
    } else {
      return;
    }

    // Update alert icon count
    this.updateAlertCount(this.currentAlertIds ? this.currentAlertIds.size : 0);

    if (!alertsMap || alertsMap.size === 0) {
      bodyElement.innerHTML = '';
      return;
    }

    // Convert Map to array for iteration
    let alertsArray = Array.from(alertsMap.values());

    // Apply user filter if one is active (Flash/Urgent/Alert icon click)
    if (this.currentFilter) {
      alertsArray = alertsArray.filter((alert) => {
        const alertType = this.getAlertType(alert);
        return alertType === this.currentFilter;
      });
    }

    // Check if alerts list container exists
    let alertsListContainer = qs('.dataminr-alerts-list', integrationContainer);

    // Always rebuild if filtering is active or container doesn't exist or showAll is true
    // This ensures filtered alerts are properly displayed
    if (!alertsListContainer || showAll || this.currentFilter !== null) {
      // Save scroll position before removing container
      let savedScrollTop = 0;
      if (alertsListContainer) {
        savedScrollTop = alertsListContainer.scrollTop;
        alertsListContainer.remove();
      }
      // If there are more than maxVisibleTags alerts, show maxVisibleTags - 1 to leave room for "+ remaining" button
      // Otherwise, show all alerts
      const maxToShow =
        alertsArray.length > this.maxVisibleTags
          ? this.maxVisibleTags - 1
          : this.maxVisibleTags;
      const alertsToShow = showAll ? alertsArray : alertsArray.slice(0, maxToShow);

      // Build alerts inner HTML - only process first maxToShow
      let alertsHtml = '<div class="dataminr-alerts-list">';
      alertsToShow.forEach((alert) => {
        const alertType = this.getAlertType(alert);
        const headline = this.getAlertHeadline(alert);
        const alertClass = 'dataminr-tag-' + this.normalizeAlertType(alertType);
        const alertId = alert.alertId || 'alert-' + alertsArray.indexOf(alert);

        alertsHtml += `
          <button class="dataminr-tag ${alertClass}" data-alert-id="${htmlEscape(
          alertId
        )}" title="${htmlEscape(headline)}">
            <div class="dataminr-alert-tag-text">
              <span class="dataminr-tag-acronym">${htmlEscape(
                this.userConfig.acronym
              )}</span> 
              <span class="dataminr-tag-headline">${htmlEscape(headline)}</span>
            </div>
          </button>
        `;
      });

      // If there are more than maxVisibleTags alerts, add a "+# remaining" item
      const remainingCount = alertsArray.length - maxToShow;
      const displayRemaining = showAll || remainingCount <= 0 ? 'none' : 'block';
      alertsHtml += `
        <button class="dataminr-tag dataminr-tag-alert" data-alert-id="remaining" title="Remaining alerts" style="display: ${displayRemaining}">
          <div class="dataminr-alert-tag-text">
            <span class="dataminr-tag-acronym">${htmlEscape(
              this.userConfig.acronym
            )}</span> 
            <span id="dataminr-remaining-count" class="dataminr-tag-headline">+${remainingCount}</span>
          </div>
        </button>
      `;
      alertsHtml += '</div>';

      // Ensure details container exists (details are built dynamically when shown)
      this.getDataminrDetailsContainerForIntegration();

      bodyElement.innerHTML = alertsHtml;
      alertsListContainer = qs('.dataminr-alerts-list', integrationContainer);

      // Restore scroll position after DOM is updated and painted
      if (alertsListContainer && savedScrollTop > 0) {
        requestAnimationFrame(() => {
          if (alertsListContainer) {
            alertsListContainer.scrollTop = savedScrollTop;
          }
        });
      }

      // Note: Click handlers are managed by setupAlertTagDelegation() - no individual listeners needed
    } else {
      // Container exists, check if we need to add more alerts
      const visibleTagButtons = qsa(
        '.dataminr-tag[data-alert-id]:not([data-alert-id="remaining"])',
        integrationContainer
      );
      const displayedAlertIds = new Set();
      visibleTagButtons.forEach((btn) => {
        const id = btn.getAttribute('data-alert-id');
        if (id && id !== 'remaining') {
          displayedAlertIds.add(id);
        }
      });

      // Find alerts that aren't displayed yet
      const availableAlerts = alertsArray.filter((alert) => {
        const id = alert.alertId || '';
        return id && !displayedAlertIds.has(id);
      });

      // Add alerts up to maxVisibleTags visible tags total
      const visibleCount = visibleTagButtons.length;
      const alertsToAdd = Math.min(
        this.maxVisibleTags - visibleCount,
        availableAlerts.length
      );
      for (let i = 0; i < alertsToAdd; i++) {
        const alert = availableAlerts[i];
        if (alert) {
          const alertId = alert.alertId || 'alert-' + i;
          this.addSingleAlertToUI(alert, alertId);
        }
      }

      // Update the remaining button count
      this.updateRemainingButton();
    }
  }

  /**
   * Load and display alerts
   * @private
   */
  async loadAlerts(count) {
    // Check for count parameter in URL (for initial query)
    if (!count) return;
    const newAlerts = await this.getAlerts(count);

    // Merge new alerts into currentAlerts Map
    // Update existing alerts or add new ones
    newAlerts.forEach((newAlert) => {
      this.processNewAlert(newAlert);
    });

    if (newAlerts.length > 0) {
      // Update the display with the merged alerts
      this.updateAlertsDisplay(Array.from(this.currentAlertIds.values()));
    }
  }

  /**
   * Get URL parameter value by name
   * @private
   * @param {string} name - Parameter name
   * @returns {string|null} Parameter value or null if not found
   */
  getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    const lowerName = name.toLowerCase();
    for (const [key, value] of urlParams.entries()) {
      if (key.toLowerCase() === lowerName) {
        return value;
      }
    }
    return null;
  }

  /**
   * Get a single alert by ID from the backend API
   * @private
   * @param {string} alertId - Alert ID to fetch
   * @returns {Promise<Object|null>} Resolves with alert object or null if not found
   */
  async getAlertById(alertId) {
    if (!alertId) {
      console.error('Alert ID is required');
      return null;
    }

    try {
      const response = await this.sendIntegrationMessage({
        action: 'getAlertById',
        alertId: alertId
      });

      if (response && response.alert) {
        return response.alert;
      }
      return null;
    } catch (error) {
      console.error('Error getting alert by ID:', error);
      return null;
    }
  }

  /**
   * Look up alert by ID from URL parameter and log to console
   * @private
   */
  async lookupAlertFromUrl() {
    const alertId = this.getUrlParameter('alert') || this.getUrlParameter('alertId');
    if (!alertId) {
      return;
    }

    try {
      const alert = await this.getAlertById(alertId);

      if (alert) {
        console.log(
          `Note: the API response for a single alert may not be cosnistant with the result returned from the alerts list.\nFor example, the listsMatched array is not included in the single alert response, but is included in the alerts list response like getAlerts().`
        );
        console.log('Looking up alert from URL parameter:', alertId, alert);

        // Store alert in Maps
        this.processNewAlert(alert);

        // Update alert count
        this.updateAlertCount(this.currentAlertIds ? this.currentAlertIds.size : 0);

        // Update the display with the updated alerts
        this.updateAlertsDisplay(Array.from(this.currentAlertIds.values()));

        // Make the alert detail visible and active
        setTimeout(() => {
          // Find and activate the tag button for this alert
          const integrationContainer = this.getIntegrationContainer();
          if (!integrationContainer) return;
          const allTagButtons = qsa('.dataminr-tag[data-alert-id]', integrationContainer);
          let tagButton = null;
          for (let i = 0; i < allTagButtons.length; i++) {
            const btn = allTagButtons[i];
            if (btn.getAttribute('data-alert-id') === alertId) {
              tagButton = btn;
              break;
            }
          }

          if (tagButton) {
            this.deactivateAllTagButtons();
            tagButton.classList.add('active');
          }

          this.showDetail(alertId);
        }, 100);
      } else {
        console.log('Alert not found with ID:', alertId);
      }
    } catch (error) {
      console.error('Error looking up alert from URL:', error);
    }
  }

  /**
   * Start polling for alerts
   * @private
   */
  startPolling() {
    // Poll immediately
    const countParam = this.getUrlParameter('alertCount');
    const count = countParam ? parseInt(countParam, 10) : 3;
    if (count) {
      this.loadAlerts(count);
    } else {
      this.pollAlerts();
    }

    // Set up polling interval
    this.pollingInterval = setInterval(() => {
      this.pollAlerts();
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling for alerts
   * @private
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Show polling error message
   * @private
   */
  showPollingError() {
    const errorElement = byId('dataminr-polling-error');
    if (errorElement) {
      errorElement.style.display = 'inline';
    }
  }

  /**
   * Hide polling error message
   * @private
   */
  hidePollingError() {
    const errorElement = byId('dataminr-polling-error');
    if (errorElement) {
      errorElement.style.display = 'none';
    }
  }

  /**
   * Restart polling for alerts
   * @private
   */
  restartPolling() {
    // Hide error message
    this.hidePollingError();

    // Restart polling
    this.startPolling();
  }


  /**
   * Initialize the Dataminr integration
   * @private
   */
  async init() {
    setTimeout(() => {
      // The user options seem to have a delayed update, so we need to check again
      if (this.userOptions !== this.integration['userOptions']) {
        this.userOptions = this.integration['userOptions'];
        this.init();
      }
    }, 1000);


    const dataminrContainer = this.getDataminrContainerForIntegration();
    this.getDataminrDetailsContainerForIntegration();


    // Sticky alerts enabled - initialize or use existing container
    if (!dataminrContainer) {
      // Create new container
      this.currentUser = this.utils.getCurrentUser();
      await this.initPolarityPin();

      // Look up alert from URL parameter if present (fire and forget)
      this.lookupAlertFromUrl().catch(function (error) {
        console.error('Error in lookupAlertFromUrl:', error);
      });
    }

    // Common initialization for both new and existing containers
    this.updateAlertCount(0);
    this.setupAlertTagDelegation();
    this.setupCopyButtonDelegation();
    this.setupMediaErrorHandling();

    // Stop any existing polling before starting new one
    this.stopPolling();

    // Start polling after a short delay to ensure UI is ready
    setTimeout(() => {
      this.startPolling();
    }, 1000);
  }

  /**
   * Show image modal
   * @private
   * @param {string} imageSrc - Source URL of the image to display
   */
  showImageModal(imageSrc) {
    // Create modal if it doesn't exist
    let modal = byId('dataminr-image-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dataminr-image-modal';
      modal.className = 'dataminr-image-modal';
      modal.innerHTML = `
        <div class="dataminr-image-modal-overlay"></div>
        <div class="dataminr-image-modal-content">
          <img class="dataminr-image-modal-image" src="" alt="Full size image" />
        </div>
      `;
      document.body.appendChild(modal);

      // Get elements and set inline styles for overlay and content to ensure visibility
      const overlay = modal.querySelector('.dataminr-image-modal-overlay');
      const content = modal.querySelector('.dataminr-image-modal-content');

      if (overlay) {
        overlay.style.cssText =
          'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.9); cursor: pointer;';
      }
      if (content) {
        content.style.cssText =
          'position: relative; max-width: 90%; max-height: 90%; z-index: 10001; display: flex; align-items: center; justify-content: center;';
      }

      // Add close handlers

      overlay.addEventListener('click', () => {
        this.hideImageModal();
      });

      // Close on Escape key
      const escapeHandler = (e) => {
        if (
          e.key === 'Escape' &&
          modal.classList.contains('dataminr-image-modal-active')
        ) {
          this.hideImageModal();
        }
      };
      document.addEventListener('keydown', escapeHandler);
    }

    // Set image source and show modal
    const modalImage = modal.querySelector('.dataminr-image-modal-image');
    if (modalImage) {
      modalImage.src = imageSrc;
      modal.classList.add('dataminr-image-modal-active');
      // Ensure modal is visible with inline styles
      modal.style.cssText =
        'display: flex !important; align-items: center !important; justify-content: center !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; z-index: 99999 !important;';
      document.body.style.overflow = 'hidden'; // Prevent body scroll
    } else {
      console.error('Modal image element not found');
    }
  }

  /**
   * Hide image modal
   * @private
   */
  hideImageModal() {
    const modal = byId('dataminr-image-modal');
    if (modal) {
      modal.classList.remove('dataminr-image-modal-active');
      modal.style.display = 'none';
      document.body.style.overflow = ''; // Restore body scroll
    }
  }

  /**
   * Get the scrollable parent container
   * @private
   * @param {Element} element - Element to find scrollable parent for
   * @returns {Element|Window} The scrollable container or window
   */
  getScrollableContainer(element) {
    // Check for notification overlay scroll container
    const notificationContainer = getNotificationScrollContainer();
    if (notificationContainer) {
      return notificationContainer;
    }

    // Check for other common scrollable containers
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (
        (style.overflow === 'auto' ||
          style.overflow === 'scroll' ||
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll') &&
        parent.scrollHeight > parent.clientHeight
      ) {
        return parent;
      }
      parent = parent.parentElement;
    }

    // Fall back to window
    return window;
  }

  /**
   * Get scroll position from container
   * @private
   * @param {Element|Window} container - The scrollable container
   * @returns {number} The scroll position
   */
  getScrollPosition(container) {
    if (container === window) {
      return (
        window.pageYOffset || window.scrollY || document.documentElement.scrollTop || 0
      );
    }
    return container.scrollTop || 0;
  }

  /**
   * Set scroll position on container
   * @private
   * @param {Element|Window} container - The scrollable container
   * @param {number} position - The scroll position to set
   */
  setScrollPosition(container, position) {
    if (container === window) {
      window.scrollTo(0, position);
    } else {
      container.scrollTop = position;
    }
  }

  /**
   * Show entity details in inline div
   * @private
   * @param {Object} entityData - Entity data object with name, type, summary, aliases, url
   * @param {Element} triggerButton - The button that triggered the display
   */
  showEntityDetails(entityData, triggerButton) {
    if (!entityData || !entityData.name || !triggerButton) {
      console.error(
        'Invalid entity data or trigger button provided to showEntityDetails'
      );
      return;
    }

    // Find the alert detail container
    const alertDetail = triggerButton.closest('.dataminr-alert-detail');
    if (!alertDetail) {
      console.error('Could not find alert detail container');
      return;
    }

    // Determine if Alert is a Pinned Pulse.
    const isPinnedAlert = alertDetail.hasAttribute('data-alert-id');

    // Find the details container
    let detailsContainer = alertDetail.querySelector(
      '.dataminr-entity-details-container'
    );
    if (!detailsContainer) {
      console.error('Could not find entity details container');
      return;
    }

    // Save scroll position before showing entity details
    const scrollContainer = this.getScrollableContainer(alertDetail);
    const savedScrollPosition = this.getScrollPosition(scrollContainer);
    alertDetail.setAttribute(
      'data-saved-scroll-position',
      savedScrollPosition.toString()
    );
    if (scrollContainer !== window) {
      alertDetail.setAttribute('data-scroll-container-id', scrollContainer.id || '');
    }

    // Hide entity notification classes in notification overlay scroll container
    this.hideEntityNotifications(alertDetail);

    // Find and hide the alert detail content
    const alertDetailContent = alertDetail.querySelector(
      '.dataminr-alert-detail-content'
    );

    // Only hide the alertDetailContent for pinned alerts as non-pinned alerts
    // are hidden when we hide all entity notifications.
    if (isPinnedAlert && alertDetailContent) {
      alertDetailContent.style.display = 'none';
    }

    // Get elements
    const titleElement = detailsContainer.querySelector('.dataminr-entity-details-title');
    const typeBadge = detailsContainer.querySelector(
      '#dataminr-entity-details-type-badge'
    );
    const aboutLabel = detailsContainer.querySelector(
      '.dataminr-entity-details-about-label'
    );
    const aliasesList = detailsContainer.querySelector(
      '.dataminr-entity-details-aliases-list'
    );
    const aliasesSection = detailsContainer.querySelector(
      '#dataminr-entity-details-aliases-section'
    );
    const summaryElement = detailsContainer.querySelector(
      '.dataminr-entity-details-summary'
    );
    const summarySection = detailsContainer.querySelector(
      '#dataminr-entity-details-summary-section'
    );
    const linkSection = detailsContainer.querySelector(
      '#dataminr-entity-details-link-section'
    );

    aboutLabel.style.display = 'none';
    // Populate with entity data
    if (titleElement) {
      titleElement.textContent = entityData.name || '';
    }

    // Type badge in header
    if (entityData.type && entityData.type.trim()) {
      if (typeBadge) {
        typeBadge.textContent = entityData.type;
        typeBadge.style.display = 'inline-block';
      }
    } else {
      if (typeBadge) {
        typeBadge.style.display = 'none';
      }
    }

    // Summary
    if (entityData.summary && entityData.summary.trim()) {
      if (summaryElement) {
        summaryElement.textContent = entityData.summary;
      }
      if (summarySection) {
        summarySection.style.display = 'block';
        aboutLabel.style.display = 'inline-block';
      }
    } else {
      if (summarySection) {
        summarySection.style.display = 'none';
      }
    }

    // Aliases
    if (
      entityData.aliases &&
      Array.isArray(entityData.aliases) &&
      entityData.aliases.length > 0
    ) {
      if (aliasesList) {
        aliasesList.innerHTML = '';
        entityData.aliases.forEach((alias) => {
          if (alias && alias.trim()) {
            const aliasElement = document.createElement('li');
            aliasElement.textContent = alias;
            aliasesList.appendChild(aliasElement);
          }
        });
      }
      if (aliasesSection) {
        aliasesSection.style.display = 'block';
        aboutLabel.style.display = 'inline-block';
      }
    } else {
      if (aliasesSection) {
        aliasesSection.style.display = 'none';
      }
    }

    // Link to Dataminr
    if (entityData.url && entityData.url.trim()) {
      const linkBtn = detailsContainer.querySelector('#dataminr-entity-details-link-btn');
      if (linkBtn) {
        linkBtn.href = entityData.url;
      }
      if (linkSection) {
        linkSection.style.display = 'block';
      }
    } else {
      if (linkSection) {
        linkSection.style.display = 'none';
      }
    }

    // Products
    const productsList = detailsContainer.querySelector(
      '.dataminr-entity-details-products-list'
    );
    const productsSection = detailsContainer.querySelector(
      '#dataminr-entity-details-products-section'
    );
    if (
      entityData.products &&
      Array.isArray(entityData.products) &&
      entityData.products.length > 0
    ) {
      if (productsList) {
        productsList.innerHTML = '';
        entityData.products.forEach((product) => {
          if (product) {
            const productElement = document.createElement('li');
            const productParts = [];
            if (product.productVendor) productParts.push(product.productVendor);
            if (product.productName) productParts.push(product.productName);
            if (product.productVersion) productParts.push(product.productVersion);
            productElement.textContent = productParts.join(' ') || 'Unknown Product';
            productsList.appendChild(productElement);
          }
        });
      }
      if (productsSection) {
        productsSection.style.display = 'block';
        aboutLabel.style.display = 'inline-block';
      }
    } else {
      if (productsSection) {
        productsSection.style.display = 'none';
      }
    }

    // Scores (CVSS, EPSS, Exploitable)
    const scoresSection = detailsContainer.querySelector(
      '#dataminr-entity-details-scores-section'
    );
    const cvssItem = detailsContainer.querySelector('#dataminr-entity-details-cvss-item');
    const cvssValue = detailsContainer.querySelector(
      '#dataminr-entity-details-cvss-value'
    );
    const epssItem = detailsContainer.querySelector('#dataminr-entity-details-epss-item');
    const epssValue = detailsContainer.querySelector(
      '#dataminr-entity-details-epss-value'
    );
    const exploitableItem = detailsContainer.querySelector(
      '#dataminr-entity-details-exploitable-item'
    );
    const exploitableValue = detailsContainer.querySelector(
      '#dataminr-entity-details-exploitable-value'
    );

    let hasScores = false;

    // CVSS Score
    if (entityData.cvss !== null && entityData.cvss !== undefined) {
      if (cvssValue) {
        cvssValue.textContent = entityData.cvss.toFixed(1);
      }
      if (cvssItem) {
        cvssItem.style.display = 'block';
        hasScores = true;
      }
    } else {
      if (cvssItem) {
        cvssItem.style.display = 'none';
      }
    }

    // EPSS Score
    if (entityData.epssScore !== null && entityData.epssScore !== undefined) {
      if (epssValue) {
        epssValue.textContent = entityData.epssScore.toFixed(4);
      }
      if (epssItem) {
        epssItem.style.display = 'block';
        hasScores = true;
      }
    } else {
      if (epssItem) {
        epssItem.style.display = 'none';
      }
    }

    // Exploitable
    if (entityData.exploitable !== null && entityData.exploitable !== undefined) {
      if (exploitableValue) {
        exploitableValue.textContent = entityData.exploitable ? 'Yes' : 'No';
      }
      if (exploitableItem) {
        exploitableItem.style.display = 'block';
        hasScores = true;
      }
    } else {
      if (exploitableItem) {
        exploitableItem.style.display = 'none';
      }
    }

    if (hasScores && scoresSection) {
      scoresSection.style.display = 'block';
      aboutLabel.style.display = 'inline-block';
    } else {
      if (scoresSection) {
        scoresSection.style.display = 'none';
      }
    }

    // Country of Origin
    const countryValue = detailsContainer.querySelector(
      '.dataminr-entity-details-country-value'
    );
    const countrySection = detailsContainer.querySelector(
      '#dataminr-entity-details-country-section'
    );
    if (entityData.countryOfOrigin && entityData.countryOfOrigin.trim()) {
      if (countryValue) {
        countryValue.textContent = entityData.countryOfOrigin;
      }
      if (countrySection) {
        countrySection.style.display = 'block';
        aboutLabel.style.display = 'inline-block';
      }
    } else {
      if (countrySection) {
        countrySection.style.display = 'none';
      }
    }

    // TTPs (Threat Techniques)
    const ttpsList = detailsContainer.querySelector('.dataminr-entity-details-ttps-list');
    const ttpsSection = detailsContainer.querySelector(
      '#dataminr-entity-details-ttps-section'
    );
    if (entityData.ttps && Array.isArray(entityData.ttps) && entityData.ttps.length > 0) {
      if (ttpsList) {
        ttpsList.innerHTML = '';
        entityData.ttps.forEach((ttp) => {
          if (ttp) {
            const ttpElement = document.createElement('li');
            const ttpParts = [];
            if (ttp.techniqueId) ttpParts.push(ttp.techniqueId);
            if (ttp.techniqueName) ttpParts.push(ttp.techniqueName);
            if (ttp.tacticName) ttpParts.push(`(${ttp.tacticName})`);
            ttpElement.textContent = ttpParts.join(' ') || 'Unknown TTP';
            ttpsList.appendChild(ttpElement);
          }
        });
      }
      if (ttpsSection) {
        ttpsSection.style.display = 'block';
        aboutLabel.style.display = 'inline-block';
      }
    } else {
      if (ttpsSection) {
        ttpsSection.style.display = 'none';
      }
    }

    let closeButton;
    let detailsContainerClone;
    // The alert is not pinned which means it is in the wrong location to be viewable
    // We need to "portal" the element to the correct location
    if (!isPinnedAlert) {
      this.deactivateAllTagButtons();
      this.hideAllDetails();

      // Get or create the details container
      const dataminrDetailsContainer = this.getDataminrDetailsContainerForIntegration();

      let entityDetailsParent = dataminrDetailsContainer.querySelector(
        '.dataminr-entity-details'
      );

      if (!entityDetailsParent) {
        entityDetailsParent = Object.assign(document.createElement('div'), {
          className: this.buildClassName('dataminr-entity-details')
        });
      }
      const entityDetailsTargetContainer = Object.assign(document.createElement('div'), {
        className: 'dataminr-entity-detail',
        style: 'display: block; margin-top: 0;'
      });
      entityDetailsParent.appendChild(entityDetailsTargetContainer);
      dataminrDetailsContainer.appendChild(entityDetailsParent);

      if (detailsContainer && entityDetailsTargetContainer) {
        entityDetailsTargetContainer.innerHTML = '';
        detailsContainerClone = detailsContainer.cloneNode(true);
        entityDetailsTargetContainer.appendChild(detailsContainerClone);
        closeButton = detailsContainerClone.querySelector(
          '.dataminr-entity-details-close'
        );
      }
    } else {
      closeButton = detailsContainer.querySelector('.dataminr-entity-details-close');
    }

    // Set up close button handler (after potential cloning) if not already set
    if (closeButton && !closeButton.hasAttribute('data-handler-attached')) {
      closeButton.setAttribute('data-handler-attached', 'true');
      closeButton.addEventListener('click', () => {
        this.hideEntityDetails(alertDetail);
      });
    }

    // Make the details container visible after any potential portaling of
    // non-pinned alerts
    if (isPinnedAlert) {
      detailsContainer.style.display = 'block';
    } else if (detailsContainerClone) {
      detailsContainerClone.style.display = 'block';
    }

    // Scroll to the top when opening entity details
    this.scrollToTop(alertDetail);
  }

  /**
   * Hide entity details
   * @private
   * @param {Element} alertDetail - The alert detail element
   */
  hideEntityDetails(alertDetail) {
    if (!alertDetail) {
      return;
    }

    const isPinnedAlert = alertDetail.hasAttribute('data-alert-id');

    if (isPinnedAlert) {
      const detailsContainer = alertDetail.querySelector(
        '.dataminr-entity-details-container'
      );
      if (detailsContainer) {
        detailsContainer.style.display = 'none';
      }

      // Restore entity notification classes in notification overlay scroll container
      this.restoreEntityNotifications(alertDetail);

      // Show the alert detail content
      const alertDetailContent = alertDetail.querySelector(
        '.dataminr-alert-detail-content'
      );
      if (alertDetailContent) {
        alertDetailContent.style.display = 'block';
      }
    } else {
      // Get or create the details container
      const dataminrDetailsContainer = this.getDataminrDetailsContainerForIntegration();

      let entityDetailsTargetContainer = dataminrDetailsContainer.querySelector(
        '.dataminr-entity-details'
      );

      if (entityDetailsTargetContainer) {
        entityDetailsTargetContainer.innerHTML = '';
      }

      // Restore entity notification classes in notification overlay scroll container
      this.restoreEntityNotifications(alertDetail);
    }

    // Restore scroll position
    const savedScrollPosition = alertDetail.getAttribute('data-saved-scroll-position');
    if (savedScrollPosition !== null) {
      const scrollPosition = parseFloat(savedScrollPosition);
      const scrollContainerId = alertDetail.getAttribute('data-scroll-container-id');

      let scrollContainer;
      if (scrollContainerId) {
        scrollContainer = byId(scrollContainerId);
      }

      if (!scrollContainer) {
        scrollContainer = this.getScrollableContainer(alertDetail);
      }

      // Use requestAnimationFrame to ensure DOM has updated before scrolling
      requestAnimationFrame(() => {
        this.setScrollPosition(scrollContainer, scrollPosition);
        // Clean up the saved scroll position attributes
        alertDetail.removeAttribute('data-saved-scroll-position');
        alertDetail.removeAttribute('data-scroll-container-id');
      });
    }
  }

  /**
   * Show metadata details (Key Points) in overlay view
   * @private
   * @param {Element} triggerElement - The element that triggered the display
   */
  showMetadataDetails(triggerElement) {
    if (!triggerElement) {
      console.error('No trigger element provided to showMetadataDetails');
      return;
    }

    // Find the alert detail container
    const alertDetail = triggerElement.closest('.dataminr-alert-detail');
    if (!alertDetail) {
      console.error('Could not find alert detail container');
      return;
    }

    // Find the metadata details overlay
    const detailsOverlay = alertDetail.querySelector(
      '.dataminr-metadata-details-overlay'
    );
    if (!detailsOverlay) {
      console.error('Could not find metadata details overlay');
      return;
    }

    // Determine if Alert is a Pinned Pulse.
    const isPinnedAlert = alertDetail.hasAttribute('data-alert-id');

    // Save scroll position before showing metadata details
    const scrollContainer = this.getScrollableContainer(alertDetail);
    const savedScrollPosition = this.getScrollPosition(scrollContainer);
    alertDetail.setAttribute(
      'data-saved-metadata-scroll-position',
      savedScrollPosition.toString()
    );
    if (scrollContainer !== window) {
      alertDetail.setAttribute(
        'data-metadata-scroll-container-id',
        scrollContainer.id || ''
      );
    }

    // Hide entity notification classes in notification overlay scroll container
    this.hideEntityNotifications(alertDetail);

    // Find and hide the alert detail content
    const alertDetailContent = alertDetail.querySelector(
      '.dataminr-alert-detail-content'
    );

    // Only hide the alertDetailContent for pinned alerts as non-pinned alerts
    // are hidden when we hide all entity notifications.
    if (isPinnedAlert && alertDetailContent) {
      alertDetailContent.style.display = 'none';
    }

    let closeButton;
    let detailsOverlayClone;
    // The alert is not pinned which means it is in the wrong location to be viewable
    // We need to "portal" the element to the correct location
    if (!isPinnedAlert) {
      this.deactivateAllTagButtons();
      this.hideAllDetails();

      // Get or create the details container
      const dataminrDetailsContainer = this.getDataminrDetailsContainerForIntegration();

      let metadataDetailsParent = dataminrDetailsContainer.querySelector(
        '.dataminr-entity-details'
      );

      if (!metadataDetailsParent) {
        metadataDetailsParent = Object.assign(document.createElement('div'), {
          className: this.buildClassName('dataminr-entity-details')
        });
      }
      const metadataDetailsTargetContainer = Object.assign(
        document.createElement('div'),
        {
          className: 'dataminr-entity-detail',
          style: 'display: block; margin-top: 0;'
        }
      );
      metadataDetailsParent.appendChild(metadataDetailsTargetContainer);
      dataminrDetailsContainer.appendChild(metadataDetailsParent);

      if (detailsOverlay && metadataDetailsTargetContainer) {
        metadataDetailsTargetContainer.innerHTML = '';
        detailsOverlayClone = detailsOverlay.cloneNode(true);
        metadataDetailsTargetContainer.appendChild(detailsOverlayClone);
        closeButton = detailsOverlayClone.querySelector(
          '.dataminr-metadata-details-overlay-close'
        );
      }
    } else {
      closeButton = detailsOverlay.querySelector(
        '.dataminr-metadata-details-overlay-close'
      );
    }

    // Set up close button handler (after potential cloning) if not already set
    if (closeButton && !closeButton.hasAttribute('data-handler-attached')) {
      closeButton.setAttribute('data-handler-attached', 'true');
      closeButton.addEventListener('click', () => {
        this.hideMetadataDetails(alertDetail);
      });
    }

    // Make the details overlay visible after any potential portaling of
    // non-pinned alerts
    if (isPinnedAlert) {
      detailsOverlay.style.display = 'block';
    } else if (detailsOverlayClone) {
      detailsOverlayClone.style.display = 'block';
    }

    // Scroll to the top when opening metadata details
    this.scrollToTop(alertDetail);
  }

  /**
   * Scroll to the top when opening entity ormetadata details
   * @private
   * @param {Element} alertDetail - The alert detail element
   */
  scrollToTop(alertDetail) {
    setTimeout(() => {
      // Scroll the scrollable container so entity details container is at the top
      const scrollContainer = this.getScrollableContainer(alertDetail);
      const alertDetailRect = alertDetail.getBoundingClientRect();
      const paddingTop = 10; // .dataminr-alert-detail has padding: 10px
      const containerRect = scrollContainer.getBoundingClientRect();
      const relativeTop =
        alertDetailRect.top - containerRect.top + scrollContainer.scrollTop - paddingTop;
      scrollContainer.scrollTop = Math.max(0, relativeTop);
    }, 0);
  }

  /**
   * Hide metadata details overlay
   * @private
   * @param {Element} alertDetail - The alert detail element
   */
  hideMetadataDetails(alertDetail) {
    if (!alertDetail) {
      return;
    }

    const isPinnedAlert = alertDetail.hasAttribute('data-alert-id');

    if (isPinnedAlert) {
      const detailsOverlay = alertDetail.querySelector(
        '.dataminr-metadata-details-overlay'
      );
      if (detailsOverlay) {
        detailsOverlay.style.display = 'none';
      }

      // Restore entity notification classes in notification overlay scroll container
      this.restoreEntityNotifications(alertDetail);

      // Show the alert detail content
      const alertDetailContent = alertDetail.querySelector(
        '.dataminr-alert-detail-content'
      );
      if (alertDetailContent) {
        alertDetailContent.style.display = 'block';
      }
    } else {
      // Get or create the details container
      const dataminrDetailsContainer = this.getDataminrDetailsContainerForIntegration();

      let metadataDetailsTargetContainer = dataminrDetailsContainer.querySelector(
        '.dataminr-entity-details'
      );

      if (metadataDetailsTargetContainer) {
        metadataDetailsTargetContainer.innerHTML = '';
      }

      // Restore entity notification classes in notification overlay scroll container
      this.restoreEntityNotifications(alertDetail);
    }

    // Restore scroll position
    const savedScrollPosition = alertDetail.getAttribute(
      'data-saved-metadata-scroll-position'
    );
    if (savedScrollPosition !== null) {
      const scrollPosition = parseFloat(savedScrollPosition);
      const scrollContainerId = alertDetail.getAttribute(
        'data-metadata-scroll-container-id'
      );

      let scrollContainer;
      if (scrollContainerId) {
        scrollContainer = byId(scrollContainerId);
      }

      if (!scrollContainer) {
        scrollContainer = this.getScrollableContainer(alertDetail);
      }

      // Use requestAnimationFrame to ensure DOM has updated before scrolling
      requestAnimationFrame(() => {
        this.setScrollPosition(scrollContainer, scrollPosition);
        // Clean up the saved scroll position attributes
        alertDetail.removeAttribute('data-saved-metadata-scroll-position');
        alertDetail.removeAttribute('data-metadata-scroll-container-id');
      });
    }
  }

  /**
   * Hide entity notification classes in notification overlay scroll container
   * @private
   * @param {Element} alertDetail - The alert detail element
   */
  hideEntityNotifications(alertDetail) {
    const notificationContainer = getNotificationScrollContainer();
    if (!notificationContainer) {
      return;
    }

    // Find all elements with classes matching _entity-notification* pattern
    const allElements = notificationContainer.querySelectorAll('*');
    const hiddenElements = [];

    allElements.forEach((element) => {
      // Check if element has any class starting with _entity-notification
      const classList = Array.from(element.classList);
      const hasEntityNotificationClass = classList.some((className) => {
        return className.indexOf('_entity-notification') === 0;
      });

      if (hasEntityNotificationClass) {
        // Save current display state
        const currentDisplay = window.getComputedStyle(element).display;
        if (currentDisplay !== 'none') {
          element.setAttribute('data-saved-display', currentDisplay);
          element.style.display = 'none';
          hiddenElements.push(element);
        }
      }
    });

    // Store reference to hidden elements on alertDetail for restoration
    if (hiddenElements.length > 0) {
      alertDetail.setAttribute(
        'data-hidden-entity-notifications',
        hiddenElements.length.toString()
      );
      // Store elements in a way we can access them later
      if (!alertDetail._hiddenEntityNotifications) {
        alertDetail._hiddenEntityNotifications = [];
      }
      alertDetail._hiddenEntityNotifications = hiddenElements;
    }
  }

  /**
   * Restore entity notification classes in notification overlay scroll container
   * @private
   * @param {Element} alertDetail - The alert detail element
   */
  restoreEntityNotifications(alertDetail) {
    if (!alertDetail || !alertDetail._hiddenEntityNotifications) {
      return;
    }

    // Restore display state for all hidden elements
    alertDetail._hiddenEntityNotifications.forEach((element) => {
      const savedDisplay = element.getAttribute('data-saved-display');
      if (savedDisplay) {
        element.style.display = savedDisplay;
        element.removeAttribute('data-saved-display');
      } else {
        // Fallback: remove inline display style to restore original
        element.style.display = '';
      }
    });

    // Clean up
    alertDetail._hiddenEntityNotifications = null;
    alertDetail.removeAttribute('data-hidden-entity-notifications');
  }

  /**
   * Show media fallback when media fails to load
   * @private
   * @param {HTMLElement} mediaElement - The media element (video/audio) that failed
   */
  showMediaFallback(mediaElement) {
    const container = mediaElement.parentElement;
    if (
      container &&
      container.classList &&
      container.classList.contains('dataminr-media-container')
    ) {
      const fallback = container.querySelector('.dataminr-media-fallback');
      if (fallback) {
        mediaElement.style.display = 'none';
        fallback.style.display = 'block';
      }
    }
  }

  /**
   * Set up error handling for external media (video, audio, etc.)
   * @private
   */
  setupMediaErrorHandling() {
    const self = this;

    // Function to attach error handlers to a media element (video or audio)
    const attachMediaErrorHandler = (mediaElement) => {
      if (!mediaElement || mediaElement.dataset.errorHandlerAttached) {
        return;
      }

      mediaElement.dataset.errorHandlerAttached = 'true';

      // Handle error event
      mediaElement.addEventListener('error', function () {
        self.showMediaFallback(mediaElement);
      });

      // Handle loadstart/loadeddata to detect CORS/403 errors
      // If media doesn't load within a reasonable time, show fallback
      let loadTimeout = null;
      let hasLoadedData = false;

      const checkLoadStatus = () => {
        // Both video and audio have readyState property
        if (!hasLoadedData && mediaElement.readyState === 0) {
          // Media hasn't started loading, might be blocked
          loadTimeout = setTimeout(() => {
            if (!hasLoadedData && mediaElement.readyState === 0) {
              self.showMediaFallback(mediaElement);
            }
          }, 3000); // Wait 3 seconds for media to start loading
        }
      };

      mediaElement.addEventListener('loadstart', () => {
        hasLoadedData = false;
        if (loadTimeout) {
          clearTimeout(loadTimeout);
        }
        checkLoadStatus();
      });

      mediaElement.addEventListener('loadeddata', () => {
        hasLoadedData = true;
        if (loadTimeout) {
          clearTimeout(loadTimeout);
        }
      });

      // Handle stalled event (works for both video and audio)
      mediaElement.addEventListener('stalled', () => {
        // Media stalled, might be blocked by CORS
        if (!hasLoadedData) {
          self.showMediaFallback(mediaElement);
        }
      });

      // Handle abort event which can fire on CORS errors
      mediaElement.addEventListener('abort', () => {
        if (!hasLoadedData) {
          self.showMediaFallback(mediaElement);
        }
      });

      // Handle suspend event - can indicate CORS blocking
      mediaElement.addEventListener('suspend', () => {
        // Only show fallback if we haven't loaded any data and media is in early loading state
        if (!hasLoadedData && mediaElement.readyState < 2) {
          // Set a short timeout to allow normal suspend events during buffering
          setTimeout(() => {
            if (!hasLoadedData && mediaElement.readyState < 2) {
              self.showMediaFallback(mediaElement);
            }
          }, 1500);
        }
      });

      // Check immediately if media is already in error state
      if (mediaElement.error && mediaElement.error.code !== 0) {
        self.showMediaFallback(mediaElement);
      }

      // Also check after a short delay to catch CORS errors that don't fire error events immediately
      setTimeout(() => {
        if (mediaElement.readyState === 0 && !hasLoadedData) {
          // Media hasn't loaded, likely blocked
          self.showMediaFallback(mediaElement);
        }
      }, 2000);
    };

    // Set up MutationObserver to catch dynamically added media elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            // Element node
            // Check if the added node is a media element or contains media elements
            let mediaElements = [];

            if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
              if (node.classList && node.classList.contains('dataminr-media-player')) {
                mediaElements = [node];
              }
            } else if (node.querySelectorAll) {
              // Find all media players
              const videos = node.querySelectorAll('video.dataminr-media-player');
              const audios = node.querySelectorAll('audio.dataminr-media-player');
              mediaElements = Array.from(videos).concat(Array.from(audios));
            }

            mediaElements.forEach((mediaElement) => {
              if (
                mediaElement.classList &&
                mediaElement.classList.contains('dataminr-media-player')
              ) {
                attachMediaErrorHandler(mediaElement);
              }
            });
          }
        });
      });
    });

    // Observe the document body for new media elements
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also attach handlers to any existing media elements
    const existingVideos = document.querySelectorAll('video.dataminr-media-player');
    const existingAudios = document.querySelectorAll('audio.dataminr-media-player');
    const existingMedia = Array.from(existingVideos).concat(Array.from(existingAudios));
    existingMedia.forEach((mediaElement) => {
      attachMediaErrorHandler(mediaElement);
    });
  }

  /**
   * Setup event delegation for alert tag button clicks
   * @private
   */
  setupAlertTagDelegation() {
    // Check if handler already attached to prevent duplicates
    if (this._alertTagHandlerAttached) {
      return;
    }
    this._alertTagHandlerAttached = true;

    // Use event delegation to handle all alert tag clicks (no individual listeners needed)
    document.body.addEventListener('click', (e) => {
      const tagButton = e.target.closest('.dataminr-tag');
      if (!tagButton) {
        return;
      }

      const alertId = tagButton.getAttribute('data-alert-id');
      if (!alertId) {
        return;
      }

      // Check if button is already active - if so, just toggle it off
      const isActive = tagButton.classList.contains('active');
      if (isActive) {
        this.handleAlertTagClick(alertId, tagButton);
        return;
      }

      // Handle remaining button - show all alerts
      if (alertId === 'remaining') {
        this.updateAlertsDisplay(Array.from(this.currentAlertIds.values()), true);
        return;
      }

      // For regular alert tags - just show the detail immediately (no need to rebuild)
      this.deactivateAllTagButtons();
      tagButton.classList.add('active');
      this.showDetail(alertId);
    });
  }

  /**
   * Set up event delegation for copy buttons and image modals
   * @private
   */
  setupCopyButtonDelegation() {
    // Check if handler already attached to prevent duplicates
    if (this._copyButtonHandlerAttached) {
      return;
    }
    this._copyButtonHandlerAttached = true;

    // Use event delegation on document body to handle dynamically created buttons
    document.body.addEventListener('click', (e) => {
      // Handle live brief copy button
      if (e.target.closest('.dataminr-alert-live-brief-copy-btn')) {
        const button = e.target.closest('.dataminr-alert-live-brief-copy-btn');
        e.stopPropagation();
        const textToCopy = button.getAttribute('data-live-brief-text') || '';
        this.copyToClipboard(textToCopy, 'Live brief copied to clipboard');
        return;
      }

      // Handle intel agents copy button
      if (e.target.closest('.dataminr-alert-intel-agents-copy-btn')) {
        const button = e.target.closest('.dataminr-alert-intel-agents-copy-btn');
        e.stopPropagation();
        const textToCopy = button.getAttribute('data-intel-agents-text') || '';
        this.copyToClipboard(textToCopy, 'Intel agents copied to clipboard');
        return;
      }

      // Handle metadata search button
      if (e.target.closest('.dataminr-alert-metadata-search-btn')) {
        const button = e.target.closest('.dataminr-alert-metadata-search-btn');
        e.stopPropagation();
        e.preventDefault();

        // Find the metadata container
        const metadataContainer = button.closest('.dataminr-alert-metadata');
        if (!metadataContainer) {
          return;
        }

        // Collect all metadata values
        const metadataValues = [];
        const valueSpans = metadataContainer.querySelectorAll(
          '.dataminr-alert-metadata-value'
        );
        valueSpans.forEach(function (span) {
          const text = span.textContent.trim();
          if (text) {
            metadataValues.push(text);
          }
        });

        // Submit each value individually
        if (metadataValues.length > 0) {
          this.submitMetadataSearchesSequentially(metadataValues);
        }
        return;
      }

      // Handle metadata details trigger (View additional details for Key Points)
      if (e.target.closest('.dataminr-vulnerability-view-details-trigger')) {
        const triggerElement = e.target.closest(
          '.dataminr-vulnerability-view-details-trigger'
        );
        e.stopPropagation();
        e.preventDefault();

        this.showMetadataDetails(triggerElement);
        return;
      }

      // Handle metadata details close button
      if (e.target.closest('.dataminr-metadata-details-overlay-close')) {
        e.stopPropagation();
        e.preventDefault();

        const closeButton = e.target.closest('.dataminr-metadata-details-overlay-close');
        const alertDetail = closeButton.closest('.dataminr-alert-detail');
        if (alertDetail) {
          this.hideMetadataDetails(alertDetail);
        }
        return;
      }

      // Handle image modal trigger
      if (e.target.classList.contains('dataminr-image-modal-trigger')) {
        e.preventDefault();
        e.stopPropagation();
        const imageSrc = e.target.getAttribute('data-image-src') || e.target.src;
        if (imageSrc) {
          this.showImageModal(imageSrc);
        }
        return;
      }

      // Also handle clicks on images inside the trigger container
      const imageTrigger = e.target.closest('.dataminr-image-modal-trigger');
      if (imageTrigger) {
        e.preventDefault();
        e.stopPropagation();
        const imageSrc = imageTrigger.getAttribute('data-image-src') || imageTrigger.src;
        if (imageSrc) {
          this.showImageModal(imageSrc);
        }
        return;
      }

      // Handle entity details trigger
      const entityTrigger = e.target.closest('.dataminr-entity-details-trigger');
      if (entityTrigger) {
        e.preventDefault();
        e.stopPropagation();
        // Try to get full entity data from JSON attribute first
        let entityData = null;
        const entityJsonStr = entityTrigger.getAttribute('data-entity-json');
        if (entityJsonStr) {
          try {
            entityData = JSON.parse(entityJsonStr);
          } catch (err) {
            console.error('Failed to parse entity JSON data:', err);
          }
        }

        // Fallback to individual data attributes if JSON not available
        if (!entityData) {
          const entityName = entityTrigger.getAttribute('data-entity-name') || '';
          const entityType = entityTrigger.getAttribute('data-entity-type') || '';
          const entitySummary = entityTrigger.getAttribute('data-entity-summary') || '';
          const entityAliasesStr =
            entityTrigger.getAttribute('data-entity-aliases') || '';
          const entityUrl = entityTrigger.getAttribute('data-entity-url') || '';

          // Parse aliases from comma-separated string
          const entityAliases = entityAliasesStr
            ? entityAliasesStr
                .split(',')
                .map((alias) => alias.trim())
                .filter((alias) => alias)
            : [];

          entityData = {
            name: entityName,
            type: entityType,
            summary: entitySummary,
            aliases: entityAliases,
            url: entityUrl
          };
        }

        if (entityData && entityData.name) {
          // Find the alert detail container
          const alertDetail = entityTrigger.closest('.dataminr-alert-detail');
          if (alertDetail) {
            // Hide any currently visible entity details
            const existingDetails = alertDetail.querySelector(
              '.dataminr-entity-details-container'
            );
            if (existingDetails && existingDetails.style.display !== 'none') {
              this.hideEntityDetails(alertDetail);
              // If clicking the same entity, just hide it (toggle behavior)
              const currentTitle = existingDetails.querySelector(
                '.dataminr-entity-details-title'
              );
              if (currentTitle && currentTitle.textContent === entityData.name) {
                return;
              }
            }
            // Show the entity details
            this.showEntityDetails(entityData, entityTrigger);
          }
        }
        return;
      }

      // Handle linked alert item click
      const linkedAlertItem = e.target.closest('.dataminr-alert-linked-alerts-item');
      if (linkedAlertItem) {
        e.preventDefault();
        e.stopPropagation();
        const linkedAlertId = linkedAlertItem.getAttribute('data-linked-alert-id');
        if (linkedAlertId) {
          // Show the detail (backend will fetch from its cache)
          this.showDetail(linkedAlertId);
        }
        return;
      }
    });
  }

  /**
   * Process a new alert: add to cache and IDs map
   * @private
   * @param {Object} alert - Alert object
   */
  processNewAlert(alert, poll = false) {
    if (!alert) return;

    const alertId = alert.alertId;
    if (!alertId) return;

    // Add to lightweight IDs map
    this.currentAlertIds.set(alertId, {
      alertId: alert.alertId,
      headline: alert.headline,
      alertType: alert.alertType,
      alertTimestamp: alert.alertTimestamp
    });
  }
}

/**
 * Initialize the Dataminr integration (called by onSettingsChange)
 * @param {Object} integration - The integration object
 * @param {Object} userConfig - User configuration object
 * @param {Object} userOptions - User options object
 * @returns {void}
 */
function initDataminr(integration, userConfig, userOptions) {
  if (!userConfig.subscribed) return;

  const integrationName = htmlEscape(userConfig.name.replaceAll(' ', ''));
  if (!window[integrationName]) {
    window[integrationName] = new DataminrIntegration(
      integration,
      userConfig,
      userOptions
    );
    // Set up observer to re-init onSettingsChange
    window[integrationName].utils.onSettingsChange((enterSettings) => {
      if (!enterSettings) {
        window[integrationName].init();
      }
    }, integrationName);
    // Set up observer to re-size on scrollbar mode changes
    window[integrationName].utils.trackScrollbarMode((overlay) => {
      const applyScrollbarClass = () => {
        const dataminrContainer =
          window[integrationName].getDataminrContainerForIntegration();
        if (dataminrContainer) {
          dataminrContainer.classList.toggle('overlay-scrollbars', overlay);
        } else {
          // Container doesn't exist yet, retry after a short delay
          setTimeout(applyScrollbarClass, 100);
        }
      };
      applyScrollbarClass();
    }, integrationName);
    // Watch the currentAlertIds map for changes
    window[integrationName].watchTrackedMap(
      window[integrationName].utils.getNotificationList().map,
      ({ op, before, after }) => {
        if (op === 'set' && after > 0) {
          // Close the alert detail if it is open
          window[integrationName].hideAllDetails();
          window[integrationName].deactivateAllTagButtons();
        }
        console.debug(
          `Notification - Operation: ${op}, Count Before: ${before}, Count After: ${after}`
        );
      }
    );
  }
}

// onSettingsChange is called once when the integration loads and then
// anytime the settings are changed (settings change is web-client only)
onSettingsChange(initDataminr);
