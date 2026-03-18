export interface SensorConfig {
  name: string;
  cities: string;
  categories?: string[];
  prefix_matching?: boolean;
  alert_timeout?: number;
}
