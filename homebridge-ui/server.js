const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const path = require('path');
const fs = require('fs');

class RedAlertUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    console.log('[RedAlert UI] Server starting, __dirname:', __dirname);

    this.onRequest('/cities', this.getCities.bind(this));
    this.onRequest('/config', this.getConfig.bind(this));
    this.onRequest('/status', this.getStatus.bind(this));
    this.onRequest('/history', this.getHistory.bind(this));
    this.onRequest('/telegram-auth', this.getTelegramAuth.bind(this));
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

  async getConfig() {
    try {
      const configPath = this.homebridgeConfigPath;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const platforms = config.platforms || [];
      const plugin = platforms.find(p => p.platform === 'RedAlert');
      return plugin || null;
    } catch (e) {
      console.log('[RedAlert UI] Failed to read config from file:', e.message);
      return null;
    }
  }

  async getStatus() {
    try {
      const statusPath = path.resolve(this.homebridgeStoragePath, 'redalert-status.json');
      const data = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      return data;
    } catch {
      return null;
    }
  }

  async getHistory() {
    try {
      const historyPath = path.resolve(this.homebridgeStoragePath, 'redalert-history.json');
      const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      return data;
    } catch {
      return [];
    }
  }

  async getTelegramAuth() {
    try {
      const authPath = path.resolve(this.homebridgeStoragePath, 'redalert-telegram-auth.json');
      const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      return data;
    } catch {
      const sessionPath = path.resolve(this.homebridgeStoragePath, 'redalert-telegram-session.txt');
      if (fs.existsSync(sessionPath) && fs.readFileSync(sessionPath, 'utf-8').trim()) {
        return { status: 'connected' };
      }
      return { status: 'not_configured' };
    }
  }
}

(() => new RedAlertUiServer())();
