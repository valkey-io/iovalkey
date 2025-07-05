import { expect } from "chai";
import { Redis } from "../../lib/Redis";
import { MaxRetriesPerRequestError } from "../../lib/errors";

describe("maxRetriesPerRequest", () => {
  it("throw the correct error when reached the limit", (done) => {
    const redis = new Redis(9999, {
      connectTimeout: 1,
      retryStrategy() {
        return 1;
      },
    });
    redis.get("foo", (err) => {
      expect(err).instanceOf(MaxRetriesPerRequestError);
      redis.disconnect();
      done();
    });
  });

  it("defaults to max 20 retries", (done) => {
    const redis = new Redis(9999, {
      connectTimeout: 1,
      retryStrategy() {
        return 1;
      },
    });
    redis.get("foo", () => {
      expect(redis.retryAttempts).to.eql(21);
      redis.get("foo", () => {
        expect(redis.retryAttempts).to.eql(42);
        redis.disconnect();
        done();
      });
    });
  });

  it("can be changed", (done) => {
    const redis = new Redis(9999, {
      maxRetriesPerRequest: 1,
      retryStrategy() {
        return 1;
      },
    });
    redis.get("foo", () => {
      expect(redis.retryAttempts).to.eql(2);
      redis.get("foo", () => {
        expect(redis.retryAttempts).to.eql(4);
        redis.disconnect();
        done();
      });
    });
  });

  it("allows 0", (done) => {
    const redis = new Redis(9999, {
      maxRetriesPerRequest: 0,
      retryStrategy() {
        return 1;
      },
    });
    redis.get("foo", () => {
      expect(redis.retryAttempts).to.eql(1);
      redis.get("foo", () => {
        expect(redis.retryAttempts).to.eql(2);
        redis.disconnect();
        done();
      });
    });
  });
});
