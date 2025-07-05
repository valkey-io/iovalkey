import { Debug } from "../utils/index.js";
import { default as Deque } from "denque";

const debug = Debug("delayqueue");

interface DelayQueueOptions {
  callback?: (cb: () => void) => void;
  timeout: number;
}

/**
 * Queue that runs items after specified duration
 */
class DelayQueue {
  private queues: { [key: string]: Deque<() => void> } = {}; 
  private timeouts: { [key: string]: NodeJS.Timer } = {};

  /**
   * Add a new item to the queue
   *
   * @param bucket bucket name
   * @param item function that will run later
   * @param options
   */
  push(bucket: string, item: () => void, options: DelayQueueOptions): void {
    const callback = options.callback || process.nextTick;
    if (!this.queues[bucket]) {
      this.queues[bucket] = new Deque();
    }

    const queue = this.queues[bucket];
    queue.push(item);

    if (!this.timeouts[bucket]) {
      this.timeouts[bucket] = setTimeout(() => {
        callback(() => {
          this.timeouts[bucket] = null;
          this.execute(bucket);
        });
      }, options.timeout);
    }
  }

  private execute(bucket: string): void {
    const queue = this.queues[bucket];
    if (!queue) {
      return;
    }
    const { length } = queue;
    if (!length) {
      return;
    }
    debug("send %d commands in %s queue", length, bucket);

    this.queues[bucket] = null;
    while (queue.length > 0) {
      queue.shift()();
    }
  }

}

export { DelayQueue, DelayQueueOptions };
export default DelayQueue;