import tls from "tls";
import net from "net";
import Redis from "../../lib/Redis";
import { expect } from "chai";
import sinon from "sinon";
import MockServer from "../helpers/mock_server";

describe("tls option", () => {
  describe("Standalone", () => {
    it("supports tls", (done) => {
      let redis;

      // @ts-expect-error
      const stub = sinon.stub(tls, "connect").callsFake((op) => {
        // @ts-expect-error
        expect(op.ca).to.eql("123");
        // @ts-expect-error
        expect(op.servername).to.eql("localhost");
        // @ts-expect-error
        expect(op.rejectUnauthorized).to.eql(false);
        // @ts-expect-error
        expect(op.port).to.eql(6379);
        const stream = net.createConnection(op);
        stream.on("connect", (data) => {
          stream.emit("secureConnect", data);
        });
        return stream;
      });

      redis = new Redis({
        tls: { ca: "123", servername: "localhost", rejectUnauthorized: false },
      });
      redis.on("ready", () => {
        redis.disconnect();
        stub.restore();
        redis.on("end", () => done());
      });
    });
  });

  describe("Sentinel", () => {
    it("does not use tls option by default", (done) => {
      new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "6379"];
        }
      });

      const stub = sinon.stub(tls, "connect").callsFake(() => {
        throw new Error("called");
      });

      const redis = new Redis({
        sentinels: [{ port: 27379 }],
        name: "my",
        tls: { ca: "123" },
      });
      redis.on("ready", () => {
        redis.disconnect();
        stub.restore();
        done();
      });
    });

    it("can be enabled by `enableTLSForSentinelMode`", (done) => {
      new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "6379"];
        }
      });

      let redis;

      const stub = sinon.stub(tls, "connect").callsFake((op) => {
        // @ts-expect-error
        expect(op.ca).to.eql("123");
        // @ts-expect-error
        expect(op.servername).to.eql("localhost");
        // @ts-expect-error
        expect(op.rejectUnauthorized).to.eql(false);
        redis.disconnect();
        stub.restore();
        process.nextTick(done);
        return tls.connect(op);
      });

      redis = new Redis({
        sentinels: [{ port: 27379 }],
        name: "my",
        tls: { ca: "123", servername: "localhost", rejectUnauthorized: false },
        enableTLSForSentinelMode: true,
      });
    });

    it("supports sentinelTLS", (done) => {
      new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "6379"];
        }
      });

      let redis;

      // @ts-expect-error
      const stub = sinon.stub(tls, "connect").callsFake((op) => {
        // @ts-expect-error
        expect(op.ca).to.eql("123");
        // @ts-expect-error
        expect(op.servername).to.eql("localhost");
        // @ts-expect-error
        expect(op.rejectUnauthorized).to.eql(false);
        // @ts-expect-error
        expect(op.port).to.eql(27379);
        const stream = net.createConnection(op);
        stream.on("connect", (data) => {
          stream.emit("secureConnect", data);
        });
        return stream;
      });

      redis = new Redis({
        sentinels: [{ port: 27379 }],
        name: "my",
        sentinelTLS: {
          ca: "123",
          servername: "localhost",
          rejectUnauthorized: false,
        },
      });
      redis.on("ready", () => {
        redis.disconnect();
        stub.restore();
        redis.on("end", () => done());
      });
    });
  });
});
