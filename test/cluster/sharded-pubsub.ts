import { expect } from "chai";
import * as calculateSlot from "cluster-key-slot";
import { Cluster } from "../../lib";

const startupNode = { host: "127.0.0.1", port: 30000 };
const channels = ["bar", "channel-two", "foo"];

function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeout}ms`)),
      timeout
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

describe("sharded Pub/Sub against Valkey Cluster", function () {
  this.timeout(15000);

  it("delivers messages for channels owned by different primaries", async () => {
    const subscriber = new Cluster([startupNode]);
    const publisher = new Cluster([startupNode]);

    try {
      await Promise.all([subscriber.info(), publisher.info()]);

      const channelByOwner = new Map<string, string>();
      for (const channel of channels) {
        const owner = subscriber["slots"][calculateSlot(channel)][0];
        channelByOwner.set(owner, channel);
      }
      const selectedChannels = Array.from(channelByOwner.values());
      expect(selectedChannels).to.have.length.greaterThan(1);

      const received = new Map<string, string>();
      const messages = new Promise<void>((resolve) => {
        subscriber.on("smessage", (channel, message) => {
          received.set(channel, message);
          if (received.size === selectedChannels.length) {
            resolve();
          }
        });
      });

      for (const channel of selectedChannels) {
        await subscriber.ssubscribe(channel);
      }
      for (const channel of selectedChannels) {
        await publisher.spublish(channel, `message:${channel}`);
      }

      await withTimeout(messages, 5000);
      for (const channel of selectedChannels) {
        expect(received.get(channel)).to.equal(`message:${channel}`);
      }
      expect(await subscriber.sunsubscribe()).to.equal(0);
    } finally {
      subscriber.disconnect();
      publisher.disconnect();
    }
  });
});
