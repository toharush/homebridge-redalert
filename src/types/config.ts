export interface SensorConfig {
  name: string;
  cities: string | string[];
  categories?: string[];
  prefix_matching?: boolean;
}
