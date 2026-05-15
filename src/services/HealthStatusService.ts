import * as fs from 'fs';

export interface SourceHealth {
  name: string;
  type: string;
  healthy: boolean;
}

export class HealthStatusService {
  constructor(private readonly filePath: string) {}

  update(status: SourceHealth[]): void {
    const tmp = this.filePath + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify(status))
      .then(() => fs.promises.rename(tmp, this.filePath))
      .catch(() => {});
  }
}
