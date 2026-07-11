import * as sinon from "sinon";
import { expect } from "chai";
import ConnectionPool from "../../../lib/cluster/ConnectionPool";

describe("ConnectionPool", () => {
  describe("#recreate", () => {
    it("replaces the existing connection with a new instance", () => {
      const pool = new ConnectionPool({});
      const oldRecord = pool.findOrCreate({
        host: "127.0.0.1",
        port: 30001,
      });
      const disconnectStub = sinon.stub(oldRecord.redis, "disconnect");

      const newRecord = pool.recreate({ host: "127.0.0.1", port: 30001 });

      expect(disconnectStub.calledOnce).to.eql(true);
      expect(newRecord.redis).to.not.equal(oldRecord.redis);
      expect(pool.getInstanceByKey("127.0.0.1:30001")).to.equal(
        newRecord.redis
      );
      expect(pool.getNodes()).to.have.lengthOf(1);
    });

    it("notifies listeners after registering the replacement", () => {
      const pool = new ConnectionPool({});
      const oldRecord = pool.findOrCreate({
        host: "127.0.0.1",
        port: 30001,
      });
      sinon.stub(oldRecord.redis, "disconnect");
      let replacement;
      const removeSpy = sinon.spy();

      pool.on("+node", (redis) => {
        replacement = redis;
      });
      pool.on("-node", () => {
        removeSpy();
        expect(pool.getInstanceByKey("127.0.0.1:30001")).to.equal(replacement);
      });

      const newRecord = pool.recreate({ host: "127.0.0.1", port: 30001 });
      expect(replacement).to.equal(newRecord.redis);
      expect(removeSpy.calledOnce).to.eql(true);
    });

    it("does not drain the pool while replacing the node", () => {
      const pool = new ConnectionPool({});
      const oldRecord = pool.findOrCreate({
        host: "127.0.0.1",
        port: 30001,
      });
      sinon.stub(oldRecord.redis, "disconnect");
      const drainSpy = sinon.spy();
      pool.on("drain", drainSpy);

      pool.recreate({ host: "127.0.0.1", port: 30001 });
      oldRecord.redis.emit("end");

      expect(drainSpy.called).to.eql(false);
      expect(pool.getNodes()).to.have.lengthOf(1);
    });

    it("creates a connection when the node is not in the pool", () => {
      const pool = new ConnectionPool({});
      const record = pool.recreate({ host: "127.0.0.1", port: 30001 });

      expect(pool.getInstanceByKey("127.0.0.1:30001")).to.equal(record.redis);
    });
  });

  describe("#reset", () => {
    it("prefers to master if there are two same node for a slot", () => {
      const pool = new ConnectionPool({});
      const stub = sinon.stub(pool, "findOrCreate");

      pool.reset([
        { host: "127.0.0.1", port: 30001, readOnly: true },
        { host: "127.0.0.1", port: 30001, readOnly: false },
      ]);

      expect(stub.callCount).to.eql(1);
      expect(stub.firstCall.args[1]).to.eql(false);

      pool.reset([
        { host: "127.0.0.1", port: 30001, readOnly: false },
        { host: "127.0.0.1", port: 30001, readOnly: true },
      ]);

      expect(stub.callCount).to.eql(2);
      expect(stub.firstCall.args[1]).to.eql(false);
    });

    it("remove the node immediately instead of waiting for 'end' event", () => {
      const pool = new ConnectionPool({});
      pool.reset([{ host: "127.0.0.1", port: 300001 }]);
      expect(pool.getNodes().length).to.eql(1);

      pool.reset([]);
      expect(pool.getNodes().length).to.eql(0);
    });
  });
});
