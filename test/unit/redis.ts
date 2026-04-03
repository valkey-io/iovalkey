import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import { RedisOptions } from "../../lib/redis/RedisOptions";

describe("Redis", () => {
  describe("constructor", () => {
    it("should parse options correctly", () => {
      const stub = sinon
        .stub(Redis.prototype, "connect")
        .returns(Promise.resolve());

      let option;
      try {
        option = getOption();
        expect(option).to.have.property("port", 6379);
        expect(option).to.have.property("host", "localhost");
        expect(option).to.have.property("family", 4);

        option = getOption(6380);
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "localhost");

        option = getOption("6380");
        expect(option).to.have.property("port", 6380);

        option = getOption(6381, "192.168.1.1");
        expect(option).to.have.property("port", 6381);
        expect(option).to.have.property("host", "192.168.1.1");

        option = getOption(6381, "192.168.1.1", {
          password: "123",
          db: 2,
        });
        expect(option).to.have.property("port", 6381);
        expect(option).to.have.property("host", "192.168.1.1");
        expect(option).to.have.property("password", "123");
        expect(option).to.have.property("db", 2);

        option = getOption("redis://:authpassword@127.0.0.1:6380/4");
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "127.0.0.1");
        expect(option).to.have.property("password", "authpassword");
        expect(option).to.have.property("db", 4);

        option = getOption("redis://:1+1@127.0.0.1:6380");
        expect(option).to.have.property("password", "1+1");

        option = getOption(
          `redis://127.0.0.1:6380/?password=${encodeURIComponent("1+1")}`
        );
        expect(option).to.have.property("password", "1+1");

        option = getOption("redis://127.0.0.1/");
        expect(option).to.have.property("db", 0);

        option = getOption("/tmp/redis.sock");
        expect(option).to.have.property("path", "/tmp/redis.sock");

        option = getOption({
          port: 6380,
          host: "192.168.1.1",
        });
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "192.168.1.1");

        option = getOption({
          path: "/tmp/redis.sock",
        });
        expect(option).to.have.property("path", "/tmp/redis.sock");

        option = getOption({
          port: "6380",
        });
        expect(option).to.have.property("port", 6380);

        option = getOption({
          showFriendlyErrorStack: true,
        });
        expect(option).to.have.property("showFriendlyErrorStack", true);

        option = getOption(6380, {
          host: "192.168.1.1",
        });
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "192.168.1.1");

        option = getOption("6380", {
          host: "192.168.1.1",
        });
        expect(option).to.have.property("port", 6380);

        option = getOption("rediss://host");
        expect(option).to.have.property("tls", true);

        option = getOption("rediss://example.test", {
          tls: { hostname: "example.test" },
        });
        expect(option.tls).to.deep.equal({ hostname: "example.test" });

        option = getOption("redis://localhost?family=6");
        expect(option).to.have.property("family", 6);
      } catch (err) {
        stub.restore();
        throw err;
      }
      stub.restore();

      function getOption(...args) {
        // @ts-expect-error
        const redis = new Redis(...args);
        return redis.options;
      }
    });

    it("should throw when arguments is invalid", () => {
      expect(() => {
        // @ts-expect-error
        new Redis(() => {});
      }).to.throw(Error);
    });
  });

  describe(".createClient", () => {
    it("should redirect to constructor", () => {
      const redis = Redis.createClient({
        name: "pass",
        lazyConnect: true,
      });
      expect(redis.options).to.have.property("name", "pass");
      expect(redis.options).to.have.property("lazyConnect", true);
    });
  });

  describe(".options.familyFallback", () => {
    const defaultFamily = 4;
    const alternateFamily = 6;

    // Helper function to create a Redis instance with common options
    const createRedisInstance = (options = {}) => {
      return new Redis({
        host: "invalid-hostname",
        // Make the test faster by reducing the initial delay
        retryStrategy: () => 10, // Only retry once after 10ms
        ...options,
      });
    };

    // Helper function to test family fallback behavior
    interface TestFamilyFallbackOptions {
      redisOptions?: RedisOptions;
      expectedFamilySequence: number[];
      retryLimit?: number;
      done: (err?: Error) => void;
      additionalAssertions?: (redis: Redis, attempt: number) => void;
    }

    const testFamilyFallback = ({
      redisOptions = {},
      expectedFamilySequence,
      retryLimit = 4,
      done,
      additionalAssertions = () => {},
    }: TestFamilyFallbackOptions) => {
      let attempts = 0;
      const redis = createRedisInstance({
        ...redisOptions,
        retryStrategy: (times) => (times > retryLimit ? null : 10),
      });

      redis.on("close", () => {
        try {
          // Test the expected family for this attempt
          if (expectedFamilySequence[attempts] !== undefined) {
            expect(redis.options.family).to.equal(
              expectedFamilySequence[attempts]
            );
          }

          // Run any additional assertions
          if (additionalAssertions) {
            additionalAssertions(redis, attempts);
          }
        } catch (err) {
          done(err);
          return;
        } finally {
          attempts++;
          if (attempts > retryLimit) {
            redis.disconnect();
            done();
          }
        }
      });
    };

    describe("basic connection tests", () => {
      it("should fail to connect to invalid host", (done) => {
        const redis = createRedisInstance();

        redis.on("error", (err) => {
          try {
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.match(/(ENOTFOUND|EAI_AGAIN)/);
          } finally {
            redis.disconnect();
            done();
          }
        });
      });

      it("should connect via IPv6 if family is 0", (done) => {
        const redis = new Redis({
          host: "localhost",
          family: 0,
        });

        redis.on("connect", () => {
          try {
            const remoteAddress = redis.stream.remoteAddress;
            const remotePort = redis.stream.remotePort;
            expect(redis.options.family).to.equal(0);
            expect(remoteAddress).not.to.equal("127.0.0.1");
            expect(remoteAddress).to.equal("::1");
            expect(remotePort).to.equal(6379);
          } catch (err) {
            done(err);
          } finally {
            redis.disconnect();
            done();
          }
        });

        redis.on("error", done);
      });
    });

    describe("family fallback disabled", () => {
      it("should not change family when familyFallback is disabled", (done) => {
        testFamilyFallback({
          redisOptions: {
            family: 0,
            familyFallback: { enabled: false },
          },
          expectedFamilySequence: [0, 0, 0, 0],
          retryLimit: 3,
          done,
        });
      });

      it("should use default family (4) when no family is specified", (done) => {
        testFamilyFallback({
          redisOptions: {
            familyFallback: { enabled: false },
          },
          expectedFamilySequence: [defaultFamily, defaultFamily, defaultFamily],
          retryLimit: 3,
          done,
        });
      });
    });

    describe("family fallback with alternate: false", () => {
      it("should try alternate family once then stick to original family", (done) => {
        const providedFamily = 6;
        const otherFamily = defaultFamily;

        testFamilyFallback({
          redisOptions: {
            family: providedFamily,
            familyFallback: { enabled: true, alternate: false },
          },
          expectedFamilySequence: [
            providedFamily, // First attempt with provided family (6)
            otherFamily, // Second attempt with alternate family (4)
            providedFamily, // Third attempt back to provided family (6)
            providedFamily, // Fourth attempt with provided family (6)
          ],
          retryLimit: 3,
          done,
          additionalAssertions: (redis, attempts) => {
            expect(redis.options.familyFallback).to.not.be.undefined;
            expect(redis.options.familyFallback?.enabled).to.equal(true);
            expect(redis.options.familyFallback?.alternate).to.equal(false);

            if (attempts > 0) {
              expect(redis.options.familyFallback?._triedFamilyFour).to.equal(
                true
              );
              expect(redis.options.familyFallback?._triedFamilySix).to.equal(
                true
              );
            }
          },
        });
      });

      it("should use default sequence (4,6,4,4) when no family is specified", (done) => {
        testFamilyFallback({
          redisOptions: {
            familyFallback: { enabled: true, alternate: false },
          },
          expectedFamilySequence: [
            defaultFamily, // First attempt with default family (4)
            alternateFamily, // Second attempt with alternate family (6)
            defaultFamily, // Third attempt back to default family (4)
            defaultFamily, // Fourth attempt with default family (4)
          ],
          retryLimit: 3,
          done,
          additionalAssertions: (redis) => {
            expect(redis.options.familyFallback?._initialFamily).to.equal(
              defaultFamily
            );
          },
        });
      });
    });

    describe("family fallback with alternate: true", () => {
      it("should alternate between provided family and fallback family", (done) => {
        const providedFamily = 6;
        const otherFamily = defaultFamily;

        testFamilyFallback({
          redisOptions: {
            family: providedFamily,
            familyFallback: { enabled: true, alternate: true },
          },
          expectedFamilySequence: [
            providedFamily, // First attempt with provided family (6)
            otherFamily, // Second attempt with alternate family (4)
            providedFamily, // Third attempt back to provided family (6)
            otherFamily, // Fourth attempt with alternate family (4)
          ],
          retryLimit: 3,
          done,
          additionalAssertions: (redis) => {
            expect(redis.options.familyFallback?.enabled).to.equal(true);
            expect(redis.options.familyFallback?.alternate).to.equal(true);
          },
        });
      });

      it("should alternate between default family (4) and alternate family (6)", (done) => {
        testFamilyFallback({
          redisOptions: {
            familyFallback: { enabled: true, alternate: true },
          },
          expectedFamilySequence: [
            defaultFamily, // First attempt with default family (4)
            alternateFamily, // Second attempt with alternate family (6)
            defaultFamily, // Third attempt back to default family (4)
            alternateFamily, // Fourth attempt with alternate family (6)
          ],
          retryLimit: 3,
          done,
        });
      });
    });
  });

  describe("#end", () => {
    it("should redirect to #disconnect", (done) => {
      const redis = new Redis({ lazyConnect: true });
      const stub = sinon.stub(redis, "disconnect").callsFake(() => {
        stub.restore();
        done();
      });
      redis.end();
    });
  });

  describe("#flushQueue", () => {
    it("should flush all queues by default", () => {
      const flushQueue = Redis.prototype.flushQueue;
      const redis = {
        offlineQueue: [{ command: { reject: () => {} } }],
        commandQueue: [{ command: { reject: () => {} } }],
      };
      const offline = sinon.mock(redis.offlineQueue[0].command);
      const command = sinon.mock(redis.commandQueue[0].command);
      offline.expects("reject").once();
      command.expects("reject").once();
      flushQueue.call(redis);
      offline.verify();
      command.verify();
    });

    it("should be able to ignore a queue", () => {
      const flushQueue = Redis.prototype.flushQueue;
      const redis = {
        offlineQueue: [{ command: { reject: () => {} } }],
        commandQueue: [{ command: { reject: () => {} } }],
      };
      const offline = sinon.mock(redis.offlineQueue[0].command);
      const command = sinon.mock(redis.commandQueue[0].command);
      offline.expects("reject").once();
      command.expects("reject").never();
      flushQueue.call(redis, new Error(), { commandQueue: false });
      offline.verify();
      command.verify();
    });
  });
});
