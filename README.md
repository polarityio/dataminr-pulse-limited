# Polarity - Dataminr Pulse (Limited) Integration

This is a limited version of the full [Dataminr Pulse Integration](https://github.com/polarityio/dataminr).  Restrictions include only on `Flash` and `Urgent` alerts.  Search will only show that there are alert matches if you were to use the full version.

Dataminr delivers the earliest warnings on high impact events and critical information far in advance of other sources.

The Polarity Dataminr Pulse integration allows Polarity to search Dataminr by all entities to get related Alerts.  The integration will return the 10 most recent related Alerts.  The integration also includes the ability to pin alerts to the top of Polarity for instant notification.

For more information on Dataminr, please visit [official website](https://www.dataminr.com/).

| <img src="./images/overlay.png" width=50%/> |
|---------------------------------------------|
| *Alerts Example*                            |

## Dataminr Integration Options
### Dataminr API URL
The base URL of the Dataminr API including the schema (i.e., https://)
- Default: `https://api.dataminr.com`
- Admin Only: Yes

### Client ID
Your Client ID Credential
- Admin Only: Yes

### Client Secret
Your Client Secret Credential
- Admin Only: Yes

### Pin Dataminr Alerts
Pin Dataminr Alerts to the top of the Polarity UI
- Default: `false`
- User Editable: Yes

### Filter Lists to Watch
Filter the lists to watch for alerts
- Default: `[]` (all lists)
- User Editable: Yes
- Multiple Selection: Yes

### Filter Alert Types
Filter the type of alert - limited
- Default: [`flash`, `urgent`]
- User Editable: Yes
- Multiple Selection: Yes

### Poll Interval
The interval in seconds for the server to poll for new Alerts
- Default: `60` seconds
- Minimum: `30` seconds
- Admin Only: Yes

## Installation Instructions

Installation instructions for integrations are provided on the [PolarityIO GitHub Page](https://polarityio.github.io/).

## Polarity

Polarity is a memory-augmentation platform that improves and accelerates analyst decision making.  For more information about the Polarity platform please see:

https://polarity.io/
