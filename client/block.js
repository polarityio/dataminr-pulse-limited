'use strict';
polarity.export = PolarityComponent.extend({
  details: Ember.computed.alias('block.data.details'),
  expandableTitleStates: Ember.computed.alias('block._state.expandableTitleStates'),
  timezone: Ember.computed('Intl', function () {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }),
  /**
   * Initialize the component and set up default state
   * @returns {void}
   */
  init() {
    if (!this.get('block._state')) {
      this.set('block._state', {});
      this.set('block._state.expandableTitleStates', {});
    }

    this._super(...arguments);
  },
  actions: {
    /**
     * Toggle the expanded state of a title section
     * @param {number} index - Index of the item to toggle
     * @param {string} type - Type of the expandable title
     * @returns {void}
     */
    toggleExpandableTitle: function (index, type) {
      this.set(
        `block._state.expandableTitleStates`,
        Object.assign({}, this.get('block._state.expandableTitleStates'), {
          [type]: Object.assign(
            {},
            this.get('block._state.expandableTitleStates')[type],
            {
              [index]: !(
                this.get('block._state.expandableTitleStates')[type] &&
                this.get('block._state.expandableTitleStates')[type][index]
              )
            }
          )
        })
      );

      this.get('block').notifyPropertyChange('data');
    }
  }
});
