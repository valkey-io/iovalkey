import { expect } from "chai";
import sinon from "sinon";
import Valkey from "../../lib/Valkey";
import MockServer from "../helpers/mock_server";

describe("commandTimeout", () => {
  it("rejects if command timed out", (done) => {
    const server = new MockServer(30001, (argv, socket, flags) => {
      if (argv[0] === "hget") {
        flags.hang = true;
        return;
      }
    });

    const redis = new Valkey({ port: 30001, commandTimeout: 1000 });
    const clock = sinon.useFakeTimers();
    redis.hget("foo", (err) => {
      expect(err.message).to.eql("Command timed out");
      clock.restore();
      redis.disconnect();
      server.disconnect(() => done());
    });
    clock.tick(1000);
  });

  it("does not leak timers for commands in offline queue", async () => {
    const server = new MockServer(30001);

    const redis = new Valkey({ port: 30001, commandTimeout: 1000 });
    const clock = sinon.useFakeTimers();
    await redis.hget("foo");
    expect(clock.countTimers()).to.eql(0);
    clock.restore();
    redis.disconnect();
    await server.disconnectPromise();
  });

  it("does not leak timers on rejected commands", async () => {
    const server = new MockServer(30001, (argv, socket, flags) => {
      if (argv[0] === "evalsha") {
        return new Error("test error");
      }
    });

    const redis = new Valkey({ port: 30001, commandTimeout: 1000000000 });
    const clock = sinon.useFakeTimers();
    let error: any;
    try {
      await redis.evalsha("asd", 0);
    } catch (err) {
      error = err;
    }

    expect(error.message).to.eql("test error");
    expect(clock.countTimers()).to.eql(0);
    clock.restore();
    redis.disconnect();
    server.disconnect();
  });
});
