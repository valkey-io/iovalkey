import { nodeKeyToRedisOptions } from "../../../lib/cluster/util";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import { expect } from "chai";
import MockServer from "../../helpers/mock_server";
import * as utils from "../../../lib/utils";

describe("cluster", () => {
  let stub: sinon.SinonStub | undefined;
  beforeEach(() => {
    stub = sinon.stub(Cluster.prototype, "connect");
    stub.callsFake(() => Promise.resolve());
  });

  afterEach(() => {
    if (stub) stub.restore();
  });

  it("should support frozen options", () => {
    const options = Object.freeze({ maxRedirections: 1000 });
    const cluster = new Cluster([{ port: 7777 }], options);
    expect(cluster.options).to.have.property("maxRedirections", 1000);
    expect(cluster.options).to.have.property("scaleReads", "master");
  });

  it("should allow overriding Commander options", () => {
    const cluster = new Cluster([{ port: 7777 }], {
      showFriendlyErrorStack: true,
    });
    expect(cluster.options).to.have.property("showFriendlyErrorStack", true);
  });

  it("should support passing keyPrefix via redisOptions", () => {
    const cluster = new Cluster([{ port: 7777 }], {
      redisOptions: { keyPrefix: "prefix:" },
    });
    expect(cluster.options).to.have.property("keyPrefix", "prefix:");
  });

  it("throws when scaleReads is invalid", () => {
    expect(() => {
      // @ts-expect-error
      new Cluster([{}], { scaleReads: "invalid" });
    }).to.throw(/Invalid option scaleReads/);
  });

  it("disables slotsRefreshTimeout by default", () => {
    const cluster = new Cluster([{}]);
    expect(cluster.options.slotsRefreshInterval).to.eql(undefined);
  });

  describe("#nodes()", () => {
    it("throws when role is invalid", () => {
      const cluster = new Cluster([{}]);
      expect(() => {
        // @ts-expect-error
        cluster.nodes("invalid");
      }).to.throw(/Invalid role/);
    });
  });

  describe("natMapper", () => {
    it("returns the original nodeKey if no NAT mapping is provided", () => {
      const cluster = new Cluster([]);
      const nodeKey = { host: "127.0.0.1", port: 6379 };
      const result = cluster["natMapper"](nodeKey);

      expect(result).to.eql(nodeKey);
    });

    it("maps external IP to internal IP using NAT mapping object", () => {
      const natMap = { "203.0.113.1:6379": { host: "127.0.0.1", port: 30000 } };
      const cluster = new Cluster([], { natMap });
      const nodeKey = "203.0.113.1:6379";
      const result = cluster["natMapper"](nodeKey);
      expect(result).to.eql({ host: "127.0.0.1", port: 30000 });
    });

    it("maps external IP to internal IP using NAT mapping function", () => {
      const natMap = (key) => {
        if (key === "203.0.113.1:6379") {
          return { host: "127.0.0.1", port: 30000 };
        }
        return null;
      };
      const cluster = new Cluster([], { natMap });
      const nodeKey = "203.0.113.1:6379";
      const result = cluster["natMapper"](nodeKey);
      expect(result).to.eql({ host: "127.0.0.1", port: 30000 });
    });

    it("returns the original nodeKey if NAT mapping is invalid", () => {
      const natMap = { "invalid:key": { host: "127.0.0.1", port: 30000 } };
      const cluster = new Cluster([], { natMap });
      const nodeKey = "203.0.113.1:6379";
      const result = cluster["natMapper"](nodeKey);
      expect(result).to.eql({ host: "203.0.113.1", port: 6379 });
    });
  });
});

describe("nodeKeyToRedisOptions()", () => {
  it("returns correct result", () => {
    expect(nodeKeyToRedisOptions("127.0.0.1:6379")).to.eql({
      port: 6379,
      host: "127.0.0.1",
    });
    expect(nodeKeyToRedisOptions("192.168.1.1:30001")).to.eql({
      port: 30001,
      host: "192.168.1.1",
    });
    expect(nodeKeyToRedisOptions("::0:6379")).to.eql({
      port: 6379,
      host: "::0",
    });
    expect(nodeKeyToRedisOptions("0:0:6379")).to.eql({
      port: 6379,
      host: "0:0",
    });
  });
});

function mockHello(port: number) {
  return ["az", port === 30001 || port === 30003 ? "zone-a" : "zone-b"];
}

function nodeHandler(port: number) {
  return (argv: any[]) => {
    if (argv[0] === "HELLO") return mockHello(port);

    if (argv[0] === "cluster" && argv[1] === "SLOTS") {
      return [
        [
          0,
          16383,
          ["127.0.0.1", 30001], // master (zone-a)
          ["127.0.0.1", 30003], // replica (zone-a)
          ["127.0.0.1", 30004], // replica (zone-b)
        ],
      ];
    }

    return port;
  };
}

describe("scaleReads = AZAffinity*", () => {
  let node1: MockServer, node3: MockServer, node4: MockServer;

  beforeEach(() => {
    node1 = new MockServer(30001, nodeHandler(30001));
    node3 = new MockServer(30003, nodeHandler(30003));
    node4 = new MockServer(30004, nodeHandler(30004));
  });

  afterEach(() => {
    node1.disconnect();
    node3.disconnect();
    node4.disconnect();
  });

  it("AZAffinity → only local replica is used", (done) => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "AZAffinity",
      clientAz: "zone-a",
    });

    cluster.on("ready", () => {
      const spy = sinon.spy(utils, "sample");
      cluster.get("foo", (_, res) => {
        spy.restore();
        expect(res).to.eql(30003); // zone-a replica
        expect(spy.notCalled).to.eql(true);
        cluster.disconnect();
        done();
      });
    });
  });

  it("AZAffinity → selects remote replica when no local replica exists", (done) => {
    node3.disconnect();

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "AZAffinity",
      clientAz: "zone-a",
      lazyConnect: false,
    });

    cluster.on("ready", async () => {
      cluster.get("foo", (_, res) => {
        expect(res).to.eql(30004); // zone-b replica
        cluster.disconnect();
        done();
      });
    });
  });

  it("AZAffinity → selects primary if no replica exist", (done) => {
    node3.disconnect();
    node4.disconnect();

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "AZAffinity",
      clientAz: "zone-a",
    });

    cluster.on("ready", () => {
      cluster.get("foo", (_, res) => {
        expect(res).to.eql(30001);
        cluster.disconnect();
        done();
      });
    });
  });

  it("AZAffinityReplicasAndPrimary → selects local primary when no local replica exists", (done) => {
    node3.disconnect();

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "AZAffinityReplicasAndPrimary",
      clientAz: "zone-a",
      lazyConnect: false,
    });

    cluster.on("ready", () => {
      cluster.get("foo", (_, res) => {
        expect(res).to.eql(30001); // zone-a master
        cluster.disconnect();
        done();
      });
    });
  });

  it("AZAffinityReplicasAndPrimary → selects local replica if available", (done) => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "AZAffinityReplicasAndPrimary",
      clientAz: "zone-a",
      lazyConnect: false,
    });

    cluster.on("ready", () => {
      const spy = sinon.spy(utils, "sample");

      cluster.get("foo", (_, res) => {
        spy.restore();

        expect(res).to.eql(30003); // zone-a replica
        expect(spy.notCalled).to.eql(true);

        cluster.disconnect();
        done();
      });
    });
  });

  it("The AZ field from the HELLO response is written into instance.options.availabilityZone", (done) => {
    const master = new MockServer(30010, (argv) => {
      if (argv[0] === "HELLO") return ["az", "zone-b"];
      if (argv[0] === "cluster" && argv[1] === "SLOTS")
        return [[0, 16383, ["127.0.0.1", 30010]]];
      return 30010;
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30010 }], {
      scaleReads: "AZAffinity",
      clientAz: "zone-b",
    });

    cluster.once("ready", () => {
      const redis =
        cluster["connectionPool"].getInstanceByKey("127.0.0.1:30010");

      cluster.get("foo", (_, res) => {
        expect(redis.options.availabilityZone).to.eql("zone-b");
        expect(res).to.eql(30010);

        cluster.disconnect();
        master.disconnect();
        done();
      });
    });
  });

  it("AZAffinityReplicasAndPrimary → selects remote replica if no local replica or master", (done) => {
    node1.disconnect(); // master (zone-a)
    node3.disconnect(); // replica (zone-a)

    const node2 = new MockServer(
      30002,
      /* master → zone-b */
      (argv: any[]) => {
        if (argv[0] === "HELLO") return mockHello(30002);

        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [
            [
              0,
              16383,
              ["127.0.0.1", 30002], // master (zone-b)
              ["127.0.0.1", 30004], // replica (zone-b)
            ],
          ];
        }
        return 30002;
      }
    );

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30002 }], {
      scaleReads: "AZAffinityReplicasAndPrimary",
      clientAz: "zone-a",
    });

    cluster.on("ready", () => {
      cluster.get("foo", (_, res) => {
        expect(res).to.eql(30004); // remote replica (zone-b)
        cluster.disconnect();
        node2.disconnect();
        done();
      });
    });
  });

  it("AZAffinityReplicasAndPrimary → selects remote master if nothing else exists", (done) => {
    node1.disconnect(); // master (zone-a)
    node3.disconnect(); // replica (zone-a)
    node4.disconnect(); // replica (zone-b)

    const node2 = new MockServer(
      30002,
      /* master → zone-b, no replica   */
      (argv: any[]) => {
        if (argv[0] === "HELLO") return mockHello(30002);

        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [
            [
              0,
              16383,
              ["127.0.0.1", 30002], // master (zone-b)
            ],
          ];
        }
        return 30002;
      }
    );

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30002 }], {
      scaleReads: "AZAffinityReplicasAndPrimary",
      clientAz: "zone-a",
    });

    cluster.on("ready", () => {
      cluster.get("foo", (_, res) => {
        expect(res).to.eql(30002); // remote master (zone-b)
        cluster.disconnect();
        node2.disconnect();
        done();
      });
    });
  });
});
