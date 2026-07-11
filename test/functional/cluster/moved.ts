import * as calculateSlot from "cluster-key-slot";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";

describe("cluster:MOVED", () => {
  it("should auto redirect the command to the correct nodes", (done) => {
    let cluster = undefined;
    let moved = false;
    let times = 0;
    const slotTable = [
      [0, 1, ["127.0.0.1", 30001]],
      [2, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (times++ === 1) {
          expect(moved).to.eql(true);
          process.nextTick(() => {
            cluster.disconnect();
            done();
          });
        }
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(moved).to.eql(false);
        moved = true;
        slotTable[0][1] = 16381;
        slotTable[1][0] = 16382;
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster.get("foo", () => {
      cluster.get("foo");
    });
  });

  it("should be able to redirect a command to a unknown node", (done) => {
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30002");
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 16381, ["127.0.0.1", 30001]],
          [16382, 16383, ["127.0.0.1", 30002]],
        ];
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnFailover: 1,
    });
    cluster.get("foo", function (err, res) {
      expect(res).to.eql("bar");
      cluster.disconnect();
      done();
    });
  });

  it("reconnects a missing master instead of using the read-only port", (done) => {
    const slotTable = [[0, 16383, ["127.0.0.1", 30001], ["127.0.0.1", 30002]]];
    let replicaWrites = 0;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "set") {
        replicaWrites += 1;
        return new Error(
          "MOVED " + calculateSlot(argv[1]) + " 127.0.0.1:30001"
        );
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);
    cluster.on("ready", () => {
      const master = cluster.nodes("master")[0];
      cluster.once("-node", () => {
        cluster.set("foo", "bar", (err, result) => {
          expect(err).to.eql(null);
          expect(result).to.eql("OK");
          expect(replicaWrites).to.eql(0);
          cluster.disconnect();
          done();
        });
      });
      master.stream.destroy();
    });
  });

  it("recreates a stale connection on a circular MOVED", (done) => {
    // Simulate a proxy whose backend changed while the pooled socket remained
    // open. The stale socket redirects to its own endpoint; a fresh socket works.
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    let swapped = false;
    let movedCount = 0;
    const freshSockets = new Set();
    const server = new MockServer(30001, (argv, socket) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (swapped && !freshSockets.has(socket)) {
          movedCount += 1;
          return new Error(
            "MOVED " + calculateSlot("foo") + " 127.0.0.1:30001"
          );
        }
        return "bar";
      }
    });
    server.on("connect", (socket) => {
      if (swapped) {
        freshSockets.add(socket);
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);
    cluster.get("foo", (err, result) => {
      expect(err).to.eql(null);
      expect(result).to.eql("bar");
      swapped = true;

      cluster.get("foo", (retryErr, retryResult) => {
        expect(retryErr).to.eql(null);
        expect(retryResult).to.eql("bar");
        expect(movedCount).to.eql(1);
        cluster.disconnect();
        done();
      });
    });
  });

  it("recreates a stale connection only once for concurrent MOVEDs", (done) => {
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    let swapped = false;
    const freshSockets = new Set();
    const server = new MockServer(30001, (argv, socket) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (swapped && !freshSockets.has(socket)) {
          return new Error(
            "MOVED " + calculateSlot("foo") + " 127.0.0.1:30001"
          );
        }
        return "bar";
      }
    });
    server.on("connect", (socket) => {
      if (swapped) {
        freshSockets.add(socket);
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);
    cluster.get("foo", (err, result) => {
      expect(err).to.eql(null);
      expect(result).to.eql("bar");
      swapped = true;
      const recreateSpy = sinon.spy(cluster.connectionPool, "recreate");

      Promise.all([cluster.get("foo"), cluster.get("foo")]).then(
        ([first, second]) => {
          expect(first).to.eql("bar");
          expect(second).to.eql("bar");
          expect(recreateSpy.callCount).to.eql(1);
          cluster.disconnect();
          done();
        },
        done
      );
    });
  });

  it("should auto redirect the command within a pipeline", (done) => {
    let cluster = undefined;
    let moved = false;
    let times = 0;
    const slotTable = [
      [0, 1, ["127.0.0.1", 30001]],
      [2, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (times++ === 1) {
          expect(moved).to.eql(true);
          process.nextTick(() => {
            cluster.disconnect();
            done();
          });
        }
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(moved).to.eql(false);
        moved = true;
        slotTable[0][1] = 16381;
        slotTable[1][0] = 16382;
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: false,
    });
    cluster.get("foo", () => {
      cluster.get("foo");
    });
  });

  it("should supports retryDelayOnMoved", (done) => {
    let cluster = undefined;
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30002");
      }
    });

    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        cluster.disconnect();
        done();
      }
    });

    const retryDelayOnMoved = 789;
    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnMoved,
    });
    cluster.on("ready", () => {
      sinon.stub(global, "setTimeout").callsFake((body, ms) => {
        if (ms === retryDelayOnMoved) {
          process.nextTick(() => {
            body();
          });
        }
      });

      cluster.get("foo");
    });
  });
});
