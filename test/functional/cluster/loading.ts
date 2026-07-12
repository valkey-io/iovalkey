import { expect } from "chai";
import * as sinon from "sinon";
import { Cluster } from "../../../lib";
import * as utils from "../../../lib/utils";
import MockServer from "../../helpers/mock_server";

describe("cluster:LOADING", () => {
  const slotTable = [[0, 16383, ["127.0.0.1", 30001], ["127.0.0.1", 30002]]];

  afterEach(() => {
    sinon.restore();
  });

  it("retries a read when a replica is loading", (done) => {
    let replicaReads = 0;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      return "master";
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get") {
        if (replicaReads++ === 0) {
          return new Error("LOADING Redis is loading the dataset in memory");
        }
        return "replica";
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "slave",
      retryDelayOnTryAgain: 1,
    });
    cluster.get("foo", (err, result) => {
      expect(err).to.eql(null);
      expect(result).to.eql("replica");
      expect(replicaReads).to.eql(2);
      cluster.disconnect();
      done();
    });
  });

  it("falls back to the primary when scaleReads is all", (done) => {
    let masterReads = 0;
    let replicaReads = 0;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get") {
        masterReads += 1;
        return "master";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get") {
        replicaReads += 1;
        return new Error("LOADING Redis is loading the dataset in memory");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "all",
      retryDelayOnTryAgain: 1,
    });
    cluster.on("ready", () => {
      sinon.stub(utils, "sample").returns("127.0.0.1:30002");
      cluster.get("foo", (err, result) => {
        expect(err).to.eql(null);
        expect(result).to.eql("master");
        expect(replicaReads).to.eql(1);
        expect(masterReads).to.eql(1);
        cluster.disconnect();
        done();
      });
    });
  });

  it("preserves LOADING errors for primary-only reads", (done) => {
    let reads = 0;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "get") {
        reads += 1;
        return new Error("LOADING Redis is loading the dataset in memory");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      retryDelayOnTryAgain: 1,
    });
    cluster.get("foo", (err) => {
      expect(err).to.have.property(
        "message",
        "LOADING Redis is loading the dataset in memory"
      );
      expect(reads).to.eql(1);
      cluster.disconnect();
      done();
    });
  });
});
