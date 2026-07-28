import MockServer, { getConnectionName } from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

const SUBSCRIBER_NAME = "ioredis-cluster(ssubscriber)";

function waitFor(
  condition: () => boolean,
  timeout = 2000,
  interval = 10
): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - started >= timeout) {
        reject(new Error("Timed out waiting for condition"));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

describe("cluster:spub/ssub", function () {
  it("routes sharded subscriptions to the slot owner", async () => {
    let subscribedPort: number;
    const handler = (port: number) => (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 8000, ["127.0.0.1", 30001]],
          [8001, 16383, ["127.0.0.1", 30002]],
        ];
      }
      if (argv[0] === "ssubscribe") {
        subscribedPort = port;
        return ["ssubscribe", argv[1], 1];
      }
    };
    new MockServer(30001, handler(30001));
    const owner = new MockServer(30002, handler(30002));
    const subscriber = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    const message = new Promise<[string, string]>((resolve) => {
      subscriber.once("smessage", (channel, value) => {
        resolve([channel, value]);
      });
    });

    await subscriber.ssubscribe("test cluster"); // slot 14862
    expect(subscribedPort).to.equal(30002);

    const connection = owner.findClientByName(SUBSCRIBER_NAME);
    expect(connection).to.not.equal(undefined);
    owner.write(connection, ["smessage", "test cluster", "hi"]);

    expect(await message).to.deep.equal(["test cluster", "hi"]);
    subscriber.disconnect();
  });

  it("keeps regular commands on regular cluster connections", async () => {
    const handler = (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const subscriber = new Cluster([{ port: 30001 }]);
    await subscriber.ssubscribe("test cluster");
    expect(await subscriber.set("foo", "bar")).to.equal("OK");
    subscriber.disconnect();
  });

  it("passes authentication options to sharded subscribers", async () => {
    const handler = (argv, connection) => {
      if (argv[0] === "auth") {
        connection.password = argv[1];
      }
      if (argv[0] === "ssubscribe") {
        expect(connection.password).to.equal("abc");
        expect(getConnectionName(connection)).to.equal(SUBSCRIBER_NAME);
        return ["ssubscribe", argv[1], 1];
      }
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const subscriber = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisOptions: { password: "abc" },
    });
    await subscriber.ssubscribe("test cluster");
    subscriber.disconnect();
  });

  it("unsubscribes from every sharded subscriber without channel arguments", async () => {
    const unsubscribedPorts: number[] = [];
    const handler = (port: number) => (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 8000, ["127.0.0.1", 30001]],
          [8001, 16383, ["127.0.0.1", 30002]],
        ];
      }
      if (argv[0] === "ssubscribe") {
        return ["ssubscribe", argv[1], 1];
      }
      if (argv[0] === "sunsubscribe") {
        unsubscribedPorts.push(port);
        return ["sunsubscribe", null, 0];
      }
    };
    new MockServer(30001, handler(30001));
    new MockServer(30002, handler(30002));
    const subscriber = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    await subscriber.ssubscribe("bar"); // slot 5061
    await subscriber.ssubscribe("foo"); // slot 12182
    expect(await subscriber.sunsubscribe("bar")).to.equal(1);
    expect(await subscriber.sunsubscribe()).to.equal(0);
    expect(unsubscribedPorts.sort()).to.deep.equal([30001, 30002]);

    subscriber.disconnect();
  });

  it("retries MOVED subscriptions on the redirected owner", async () => {
    const subscriptions: number[] = [];
    let moved = false;
    const handler = (port: number) => (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return moved
          ? [[0, 16383, ["127.0.0.1", 30002]]]
          : [
              [0, 8000, ["127.0.0.1", 30001]],
              [8001, 16383, ["127.0.0.1", 30002]],
            ];
      }
      if (argv[0] === "ssubscribe") {
        subscriptions.push(port);
        if (port === 30001) {
          moved = true;
          return new Error("MOVED 5061 127.0.0.1:30002");
        }
        return ["ssubscribe", argv[1], 1];
      }
    };
    new MockServer(30001, handler(30001));
    new MockServer(30002, handler(30002));
    const subscriber = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    await subscriber.ssubscribe("bar"); // slot 5061
    expect(subscriptions).to.deep.equal([30001, 30002]);
    subscriber.disconnect();
  });

  it("cleans a stale owner after MOVED while retaining its other channels", async () => {
    let moved = false;
    let oldOwnerUnsubscribes = 0;
    const handler = (port: number) => (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return moved
          ? [
              [0, 5060, ["127.0.0.1", 30001]],
              [5061, 5061, ["127.0.0.1", 30002]],
              [5062, 8000, ["127.0.0.1", 30001]],
              [8001, 16383, ["127.0.0.1", 30002]],
            ]
          : [
              [0, 8000, ["127.0.0.1", 30001]],
              [8001, 16383, ["127.0.0.1", 30002]],
            ];
      }
      if (argv[0] === "ssubscribe") {
        return ["ssubscribe", argv[1], 1];
      }
      if (argv[0] === "sunsubscribe") {
        if (port === 30001 && argv[1] === "bar") {
          oldOwnerUnsubscribes += 1;
          if (oldOwnerUnsubscribes === 1) {
            moved = true;
            return new Error("MOVED 5061 127.0.0.1:30002");
          }
        }
        return ["sunsubscribe", argv[1], 0];
      }
    };
    new MockServer(30001, handler(30001));
    new MockServer(30002, handler(30002));
    const subscriber = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    await subscriber.ssubscribe("bar"); // slot 5061
    await subscriber.ssubscribe("keep0"); // slot 7717, same initial owner
    await subscriber.ssubscribe("foo"); // slot 12182, redirected owner
    expect(await subscriber.sunsubscribe("bar")).to.equal(2);
    await waitFor(() => oldOwnerUnsubscribes === 2);

    subscriber.disconnect();
  });

  it("does not retain a subscription when SSUBSCRIBE fails", async () => {
    let subscriptions = 0;
    const handler = (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "ssubscribe") {
        subscriptions += 1;
        return new Error("ERR subscription failed");
      }
    };
    new MockServer(30001, handler);
    const subscriber = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    try {
      await subscriber.ssubscribe("bar");
      expect.fail("SSUBSCRIBE should reject");
    } catch (error) {
      expect(error.message).to.equal("ERR subscription failed");
    }
    subscriber.refreshSlotsCache();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(subscriptions).to.equal(1);
    subscriber.disconnect();
  });

  it("unsubscribes the previous owner when a slot moves", async () => {
    let ownerPort = 30002;
    const subscriptions: number[] = [];
    const unsubscriptions: number[] = [];
    const handler = (port: number) => (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", ownerPort]]];
      }
      if (argv[0] === "ssubscribe") {
        subscriptions.push(port);
        return ["ssubscribe", argv[1], 1];
      }
      if (argv[0] === "sunsubscribe") {
        unsubscriptions.push(port);
        return ["sunsubscribe", argv[1], 0];
      }
    };
    new MockServer(30001, handler(30001));
    new MockServer(30002, handler(30002));
    const subscriber = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    await subscriber.ssubscribe("test cluster");
    expect(subscriptions).to.deep.equal([30002]);

    ownerPort = 30001;
    subscriber.refreshSlotsCache();
    await waitFor(() => subscriptions.includes(30001));
    expect(unsubscriptions).to.deep.equal([30002]);

    subscriber.disconnect();
  });
});
