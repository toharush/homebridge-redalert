import { ParsedAlerts } from '../services/SensorFilter';

export interface AlertListener {
  handleAlerts(parsed: ParsedAlerts): void;
}
