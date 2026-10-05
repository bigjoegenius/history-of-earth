/**
 * Runs async jobs one at a time, always picking the most recently pushed job and dropping any
 * that were superseded before they started ("latest wins").
 *
 * Used instead of a trailing debounce for snapshot loading: setYear arrives every frame, and a
 * debounce either never fires during fast playback or fires for a snapshot that playback has
 * already left. This limits loading to one render at a time and never starves.
 */
export class LatestOnly<T> {
  private next: T | null = null;
  private running = false;

  /** `run` must handle its own errors. */
  constructor(private readonly run: (job: T) => Promise<void>) {}

  push(job: T): void {
    this.next = job;
    if (!this.running) void this.drain();
  }

  /** Drops the job waiting to start (a running job still completes). */
  cancel(): void {
    this.next = null;
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.next !== null) {
      const job = this.next;
      this.next = null;
      await this.run(job);
    }
    this.running = false;
  }
}
