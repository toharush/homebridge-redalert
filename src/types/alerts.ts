export interface AlertState {
  isActive: boolean;
  activeCities: ReadonlyMap<string, number>;
}
