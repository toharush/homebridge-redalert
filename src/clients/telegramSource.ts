import fs from 'fs';
import { OrefRealtimeAlert } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { AlertSource } from './AlertSource';
import { parseTelegramMessage } from './telegramParser';

export interface TelegramSourceConfig {
  name: string;
  channel: string;          // channel username (e.g., "CumtaAlertsChannel")
  fallbackCategory: string; // e.g., "rockets"
  failureThreshold: number;
  cityList: string[];       // pre-sorted longest-first
}

export interface SharedTelegramClient {
  connect(): Promise<void>;
  isConnected(): boolean;
  addMessageHandler(channel: string, handler: (text: string) => void): void;
  stop(): void;
}

export class TelegramSource implements AlertSource {
  readonly name: string;
  readonly type = 'telegram' as const;

  private healthy = false;
  private client: SharedTelegramClient | null = null;

  private alertCallback: ((alerts: OrefRealtimeAlert[]) => void) | null = null;
  private healthCallback: ((healthy: boolean) => void) | null = null;

  constructor(
    private readonly log: DebugLogger,
    private readonly config: TelegramSourceConfig,
    client?: SharedTelegramClient,
  ) {
    this.name = config.name;
    if (client) {
      this.client = client;
    }
  }

  bindClient(client: SharedTelegramClient): void {
    this.client = client;
    this.registerHandler();
  }

  onAlerts(callback: (alerts: OrefRealtimeAlert[]) => void): void {
    this.alertCallback = callback;
  }

  onHealthChange(callback: (healthy: boolean) => void): void {
    this.healthCallback = callback;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  setHealthy(healthy: boolean): void {
    if (this.healthy === healthy) {
      return;
    }
    this.healthy = healthy;
    this.healthCallback?.(healthy);
  }

  start(): void {
    if (this.client) {
      this.registerHandler();
    }
  }

  private registerHandler(): void {
    if (!this.client) {
      return;
    }
    this.log.info(`[${this.name}] Registering Telegram handler for channel: ${this.config.channel}`);
    this.client.addMessageHandler(this.config.channel, (text: string) => {
      this.handleMessage(text);
    });
  }

  stop(): void {
    // No-op: shared client is managed externally
  }

  private handleMessage(text: string): void {
    try {
      this.log.easyDebug(() => `[${this.name}] Message received (${text.length} chars)`);
      const alerts = parseTelegramMessage(text, this.config.fallbackCategory, this.config.cityList);
      if (alerts.length > 0) {
        this.log.easyDebug(() => `[${this.name}] Parsed ${alerts.length} alert(s) with ${alerts[0].data.length} cities`);
        this.alertCallback?.(alerts);
      }
    } catch (err) {
      this.log.error(`[${this.name}] Failed to parse Telegram message: ${err}`);
    }
  }
}

/**
 * Creates a SharedTelegramClient using the `telegram` npm package.
 * Uses dynamic import so compilation doesn't fail if the package isn't installed.
 */
export async function createSharedTelegramClient(
  log: DebugLogger,
  apiId: number,
  apiHash: string,
  sessionPath: string,
): Promise<SharedTelegramClient> {
  let TelegramClientClass: any;
  let StringSession: any;
  let NewMessage: any;
  let EditedMessage: any;

  try {
    const telegramModule = await import('telegram');
    TelegramClientClass = telegramModule.TelegramClient;
    StringSession = telegramModule.sessions.StringSession;

    const eventsModule = await import('telegram/events/index.js');
    NewMessage = eventsModule.NewMessage;

    const editedModule = await import('telegram/events/EditedMessage');
    EditedMessage = editedModule.EditedMessage;
  } catch (err) {
    log.error(`Failed to import telegram package: ${err}`);
    throw new Error('telegram package is not installed. Install it with: npm install telegram');
  }

  // Load session from file if it exists
  let sessionString = '';
  try {
    if (fs.existsSync(sessionPath)) {
      sessionString = fs.readFileSync(sessionPath, 'utf-8').trim();
      log.info('Loaded Telegram session from file');
    }
  } catch (err) {
    log.warn(`Failed to load session file: ${err}`);
  }

  const session = new StringSession(sessionString);
  const telegramClient = new TelegramClientClass(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  const handlers = new Map<string, ((text: string) => void)[]>();

  const authStatePath = sessionPath.replace('-session.txt', '-auth.json');

  function writeAuthState(state: { status: string; qrUrl?: string; error?: string }) {
    try {
      fs.writeFileSync(authStatePath, JSON.stringify(state), 'utf-8');
    } catch {}
  }

  const sharedClient: SharedTelegramClient = {
    async connect(): Promise<void> {
      writeAuthState({ status: 'connecting' });

      await telegramClient.start({
        phoneNumber: async () => {
          throw new Error('Phone auth not supported - use QR code');
        },
        password: async () => {
          throw new Error('2FA password not supported in automated mode');
        },
        phoneCode: async () => {
          throw new Error('Phone code not supported in automated mode');
        },
        qrCode: async (qrCode: { token: Buffer }) => {
          const qrUrl = `tg://login?token=${qrCode.token.toString('base64url')}`;
          log.info('=== TELEGRAM QR CODE LOGIN ===');
          log.info(`Scan this QR code in your Telegram app: ${qrUrl}`);
          log.info('==============================');
          writeAuthState({ status: 'waiting_qr', qrUrl });
        },
        onError: (err: Error) => {
          log.error(`Telegram auth error: ${err.message}`);
          writeAuthState({ status: 'error', error: err.message });
        },
      });

      // Save session to file
      const savedSession = telegramClient.session.save() as unknown as string;
      try {
        fs.writeFileSync(sessionPath, savedSession, 'utf-8');
        log.info('Saved Telegram session to file');
      } catch (err) {
        log.warn(`Failed to save session file: ${err}`);
      }
      writeAuthState({ status: 'connected' });

      // Register event handlers for new and edited messages
      const messageHandler = (event: any) => {
        const message = event.message;
        if (!message?.peerId?.channelId) {
          return;
        }

        const text = message.text || message.message || '';
        if (!text) {
          return;
        }

        // Dispatch to all registered channel handlers
        for (const [, channelHandlers] of handlers) {
          for (const handler of channelHandlers) {
            try {
              handler(text);
            } catch (err) {
              log.error(`Handler error: ${err}`);
            }
          }
        }
      };

      telegramClient.addEventHandler(messageHandler, new NewMessage({}));
      telegramClient.addEventHandler(messageHandler, new EditedMessage({}));

      log.info('Telegram client connected and listening for messages');
    },

    isConnected(): boolean {
      return telegramClient.connected;
    },

    addMessageHandler(channel: string, handler: (text: string) => void): void {
      if (!handlers.has(channel)) {
        handlers.set(channel, []);
      }
      handlers.get(channel)!.push(handler);
    },

    stop(): void {
      telegramClient.disconnect();
    },
  };

  return sharedClient;
}
