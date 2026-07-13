import { expect } from "chai";
import Redis from "../../lib/Redis";

describe("socketTimeout", () => {
  const timeoutMs = 500;

  it("should ensure correct startup with password (https://github.com/redis/ioredis/issues/1919)", (done) => {
    let timeoutObj: NodeJS.Timeout;

    const redis = new Redis({
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

    const redis = new Redis({
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
    const redis = new Redis({
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

  it("should not destroy a healthy socket after reconnecting", (done) => {
    // Arms the socketTimeout on the first socket, then drops that socket
    // before any data clears the timer. The stale timer must not survive the
    // reconnect and destroy the new, healthy socket.
    const redis = new Redis({
      socketTimeout: timeoutMs,
      lazyConnect: true,
    });

    let readyCount = 0;
    let settled = false;
    let doneTimer: NodeJS.Timeout;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(doneTimer);
      redis.disconnect();
      done(err);
    };

    redis.on("error", (err) => {
      // A socket timeout after we've already reconnected means the stale timer
      // destroyed the healthy socket — the bug we're guarding against.
      if (readyCount >= 2 && String(err.message).includes("Socket timeout")) {
        finish(
          new Error(
            "stale socketTimeout timer destroyed the reconnected socket"
          )
        );
      }
    });

    redis.on("ready", () => {
      readyCount++;
      if (readyCount === 1) {
        // Prevent the "data" handler from clearing the timer, arm it with a
        // command, then kill the socket to force a reconnect.
        redis.stream.removeAllListeners("data");
        redis.ping().catch(() => {});
        redis.stream.destroy();
      } else if (readyCount === 2) {
        // Wait past the socketTimeout window; if no spurious timeout fires on
        // the healthy socket, the bug is fixed.
        doneTimer = setTimeout(() => finish(), timeoutMs * 2);
      }
    });

    redis.connect().catch(() => {});
  });
});
