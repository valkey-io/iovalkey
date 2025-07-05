import { expect } from "chai";
import Valkey from "../../lib/Valkey";

describe("socketTimeout", () => {
  const timeoutMs = 500;

  it("should ensure correct startup with password (https://github.com/redis/ioredis/issues/1919)", (done) => {
    let timeoutObj: NodeJS.Timeout;

    const redis = new Valkey({
      socketTimeout: timeoutMs,
      lazyConnect: true,
      password: "foobared",
    });

    redis.on("error", (err) => {
      clearTimeout(timeoutObj);
      done(err.toString());
    });

    redis.connect(() => {
      timeoutObj = setTimeout(() => {
        done();
      }, timeoutMs * 2);
    });
  });

  it("should not throw error when socketTimeout is set and no command is sent", (done) => {
    let timeoutObj: NodeJS.Timeout;

    const redis = new Valkey({
      socketTimeout: timeoutMs,
      lazyConnect: true,
    });

    redis.on("error", (err) => {
      clearTimeout(timeoutObj);
      done(err.toString());
    });

    redis.connect(() => {
      timeoutObj = setTimeout(() => {
        done();
      }, timeoutMs * 2);
    });
  });

  it("should throw if socket timeout is reached", (done) => {
    const redis = new Valkey({
      socketTimeout: timeoutMs,
      lazyConnect: true,
    });

    redis.on("error", (err) => {
      expect(err.message).to.include("Socket timeout");
      done();
    });

    redis.connect(() => {
      redis.stream.removeAllListeners("data");
      redis.ping();
    });
  });
});
