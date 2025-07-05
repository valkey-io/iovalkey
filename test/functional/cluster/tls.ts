import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import sinon from "sinon";
import tls from "tls";
import net from "net";

describe("cluster:tls option", () => {
  it("supports tls", (done) => {
    const slotTable = [
      [0, 5460, ["127.0.0.1", 30001]],
      [5461, 10922, ["127.0.0.1", 30002]],
      [10923, 16383, ["127.0.0.1", 30003]],
    ];
    const argvHandler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    };

    new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);
    new MockServer(30003, argvHandler);

    // @ts-expect-error
    const stub = sinon.stub(tls, "connect").callsFake((op) => {
      // @ts-expect-error
      expect(op.ca).to.eql("123");
      // @ts-expect-error
      expect(op.port).to.be.oneOf([30001, 30003, 30003]);
      const stream = net.createConnection(op);
      stream.on("connect", (data) => {
        stream.emit("secureConnect", data);
      });
      return stream;
    });

    const cluster = new Cluster(
      [
        { host: "127.0.0.1", port: "30001" },
        { host: "127.0.0.1", port: "30002" },
        { host: "127.0.0.1", port: "30003" },
      ],
      {
        redisOptions: { tls: { ca: "123" } },
      }
    );

    cluster.on("ready", () => {
      expect(cluster.subscriber.subscriber.options.tls).to.deep.equal({
        ca: "123",
      });

      cluster.disconnect();
      stub.restore();
      cluster.on("end", () => done());
    });
  });
});
