import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { RedAlertPlatform } from './RedAlertPlatform';

export = (api: API) => {
  api.registerPlatform(PLATFORM_NAME, RedAlertPlatform);
};
