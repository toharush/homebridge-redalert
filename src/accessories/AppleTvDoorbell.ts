import type { API, DoorbellController, PlatformAccessory } from 'homebridge';
import { DebugLogger } from '../utils/debugLogger';
import { PLATFORM_NAME } from '../settings';
import { DoorbellNotifier } from '../notifiers/DoorbellNotifier';
import { AlertImageRenderer, AlertRenderer } from '../render/AlertImageRenderer';
import { AlertSnapshotDelegate } from './AlertSnapshotDelegate';

export interface AppleTvDoorbellOptions {
  name: string;
  minRingInterval: number;
  maxCities: number;
}

/**
 * An external HomeKit video doorbell. Ringing it is the only way to show a
 * banner over whatever is playing on an Apple TV; the banner's picture is the
 * camera snapshot, which here is the rendered alert card.
 *
 * Order on every alert: HomeKit sensors update first (SensorFilter), then the
 * notifiers run; the ring follows in its own setImmediate, and only after the
 * ring does the card render, in a worker thread. A slow render can only make the
 * picture late, never the ring.
 */
export class AppleTvDoorbell {
  readonly accessory: PlatformAccessory;
  readonly notifier: DoorbellNotifier;
  private readonly controller: DoorbellController;
  private readonly delegate: AlertSnapshotDelegate;
  private readonly renderer: AlertRenderer;

  constructor(
    private readonly log: DebugLogger,
    api: API,
    options: AppleTvDoorbellOptions,
    renderer?: AlertRenderer,
  ) {
    const hap = api.hap;
    this.renderer = renderer ?? new AlertImageRenderer(log, { maxCities: options.maxCities });

    this.notifier = new DoorbellNotifier(() => this.ring(), options.minRingInterval);
    this.delegate = new AlertSnapshotDelegate(this.notifier, this.renderer);

    // streamingOptions are required even though the stream is always rejected.
    this.controller = new hap.DoorbellController({
      cameraStreamCount: 1,
      delegate: this.delegate,
      streamingOptions: {
        supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: {
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            levels: [hap.H264Level.LEVEL3_1],
          },
          resolutions: [[1280, 720, 15], [640, 360, 15]],
        },
      },
    });

    // External accessories aren't cached by Homebridge, so the UUID must be stable
    // across launches or the user has to pair again.
    this.accessory = new api.platformAccessory(
      options.name, hap.uuid.generate(`${PLATFORM_NAME}-appletv-doorbell`), hap.Categories.VIDEO_DOORBELL,
    );
    this.accessory.getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'toharush')
      .setCharacteristic(hap.Characteristic.Model, 'Red Alert TV Doorbell')
      .setCharacteristic(hap.Characteristic.SerialNumber, 'RA-APPLETV-DOORBELL');
    this.accessory.configureController(this.controller);
  }

  /** Loads canvas and fonts in the worker now, so the first alert doesn't pay for it. */
  warmUp(): void {
    void this.renderer.warmUp();
  }

  destroy(): void {
    this.notifier.destroy();
    this.renderer.destroy();
  }

  private ring(): void {
    try {
      this.controller.ringDoorbell();
    } catch (err) {
      this.log.warn(`[AppleTV] Ring failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    this.log.info(`[AppleTV] Ring (${this.notifier.snapshot().active.size} active)`);
    // Render only after the ring has gone out.
    setImmediate(() => this.delegate.prewarm());
  }
}
