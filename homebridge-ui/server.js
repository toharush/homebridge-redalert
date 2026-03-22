const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const path = require('path');
const fs = require('fs');

class RedAlertUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    console.log('[RedAlert UI] Server starting, __dirname:', __dirname);

    this.onRequest('/cities', this.getCities.bind(this));
    this.ready();
  }

  async getCities() {
    const candidates = [
      path.resolve(__dirname, '..', 'dist', 'data', 'cities.json'),
      path.resolve(__dirname, '..', 'src', 'data', 'cities.json'),
    ];

    for (const citiesPath of candidates) {
      console.log('[RedAlert UI] Trying cities path:', citiesPath);
      try {
        const data = JSON.parse(fs.readFileSync(citiesPath, 'utf-8'));
        console.log('[RedAlert UI] Loaded', data.length, 'cities from', citiesPath);
        return data;
      } catch (e) {
        console.log('[RedAlert UI] Failed:', e.message);
      }
    }

    throw new Error('cities.json not found in any expected location');
  }
}

(() => new RedAlertUiServer())();
