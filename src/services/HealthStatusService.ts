import * as fs from 'fs';

export interface SourceHealth {
  name: string;
  type: string;
  healthy: boolean;
}

export class HealthStatusService {
  private writing = false;
  private pending: SourceHealth[] | null = null;

  constructor(private readonly filePath: string) {}

  clear(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // file may not exist
    }
  }

  update(status: SourceHealth[]): void {
    // Serialize writes: a concurrent update() would otherwise race on the same
    // temp path and could rename a half-written file into place. If a write is
    // already in flight, stash the latest status and flush it when that write
    // settles (latest wins).
    if (this.writing) {
      this.pending = status;
      return;
    }
    this.writing = true;

    const tmp = this.filePath + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify(status))
      .then(() => fs.promises.rename(tmp, this.filePath))
      .catch(() => {})
      .finally(() => {
        this.writing = false;
        if (this.pending) {
          const next = this.pending;
          this.pending = null;
          this.update(next);
        }
      });
  }
}
