import type { API, DoorbellController, PlatformAccessory } from 'homebridge';
import { DebugLogger } from '../utils/debugLogger';
import { PLATFORM_NAME } from '../settings';
import { DoorbellNotifier } from '../notifiers/DoorbellNotifier';
import { AlertImageRenderer, AlertRenderer } from '../render/AlertImageRenderer';
import { AlertSnapshotDelegate } from './AlertSnapshotDelegate';
import { FfmpegStillStream } from './FfmpegStillStream';

export interface AppleTvDoorbellOptions {
  name: string;
  minRingInterval: number;
  maxCities: number;
  /** ffmpeg binary for the live stream; null keeps the camera snapshot-only. */
  ffmpegPath?: string | null;
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
  private readonly stream: FfmpegStillStream | null = null;

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
    if (options.ffmpegPath) {
      this.stream = new FfmpegStillStream(
        log, this.delegate, () => hap.CameraController.generateSynchronisationSource(),
        { ffmpegPath: options.ffmpegPath },
      );
      this.delegate.stream = this.stream;
    }

    // streamingOptions are required even when the stream is rejected.
    this.controller = new hap.DoorbellController({
      // Two viewers at once (Apple TV and a phone), each with its own ffmpeg.
      cameraStreamCount: this.stream ? 2 : 1,
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
    const controller = this.controller;
    this.stream?.attach((id) => controller.forceStopStreamingSession(id));
  }

  /** Loads canvas and fonts in the worker now, and checks ffmpeg, so the first alert doesn't pay for it. */
  warmUp(): void {
    void this.renderer.warmUp();
    void this.stream?.probe();
  }

  destroy(): void {
    this.stream?.destroy();
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
