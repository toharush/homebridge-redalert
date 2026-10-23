import _ from 'lodash';
import { WebhookPayload } from './WebhookService';

/** Receives alert/ended events after the HomeKit state has been updated. */
export interface AlertNotifier {
  fire(payload: WebhookPayload): void;
}

/** Fans one event out to several notifiers. A child that throws never stops the others. */
export class CompositeNotifier implements AlertNotifier {
  private constructor(private readonly children: AlertNotifier[]) {}

  /** Returns null when no notifier is given, the only child when one is given, otherwise a composite. */
  static of(...children: Array<AlertNotifier | null | undefined>): AlertNotifier | null {
    const present = _.reject(children, _.isNil) as AlertNotifier[];
    if (present.length === 0) {
      return null;
    }
    if (present.length === 1) {
      return present[0];
    }
    return new CompositeNotifier(present);
  }

  fire(payload: WebhookPayload): void {
    for (const child of this.children) {
      try {
        child.fire(payload);
      } catch {
        // A failing notifier must not block the remaining ones.
      }
    }
  }
}
