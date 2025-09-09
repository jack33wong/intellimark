# Subscription Delay Configuration

The frontend delay system is configurable through environment variables. You can create a `frontend/.env.local` file to customize the delay values.

## Environment Variables

Create a `frontend/.env.local` file with the following variables:

```bash
# Subscription Response Delays (in milliseconds)
# Free plan delay (default: 3000ms = 3 seconds)
REACT_APP_SUBSCRIPTION_DELAY_FREE=3000

# Pro plan delay (default: 1000ms = 1 second)
REACT_APP_SUBSCRIPTION_DELAY_PRO=1000

# Enterprise plan delay (default: 0ms = no delay)
REACT_APP_SUBSCRIPTION_DELAY_ENTERPRISE=0

# Default delay for unknown subscription types (default: 3000ms = 3 seconds)
REACT_APP_SUBSCRIPTION_DELAY_DEFAULT=3000
```

## How to Configure

1. **Create the file**: Create `frontend/.env.local` in your project root
2. **Add variables**: Copy the variables above and modify the values as needed
3. **Restart the frontend**: Run `npm start` to apply the changes

## Example Configurations

### Fast Response (for testing)
```bash
REACT_APP_SUBSCRIPTION_DELAY_FREE=500
REACT_APP_SUBSCRIPTION_DELAY_PRO=200
REACT_APP_SUBSCRIPTION_DELAY_ENTERPRISE=0
REACT_APP_SUBSCRIPTION_DELAY_DEFAULT=500
```

### Slow Response (for premium feel)
```bash
REACT_APP_SUBSCRIPTION_DELAY_FREE=5000
REACT_APP_SUBSCRIPTION_DELAY_PRO=2000
REACT_APP_SUBSCRIPTION_DELAY_ENTERPRISE=500
REACT_APP_SUBSCRIPTION_DELAY_DEFAULT=5000
```

### No Delays (for development)
```bash
REACT_APP_SUBSCRIPTION_DELAY_FREE=0
REACT_APP_SUBSCRIPTION_DELAY_PRO=0
REACT_APP_SUBSCRIPTION_DELAY_ENTERPRISE=0
REACT_APP_SUBSCRIPTION_DELAY_DEFAULT=0
```

## Notes

- All delay values are in **milliseconds**
- The UI will automatically update to show the configured delay times
- If no `.env.local` file exists, the system uses the default values
- Changes require a frontend restart to take effect
