import Valkey from "../../lib/Valkey";
import { expect } from "chai";

describe("duplicate", () => {
  it("clone the options", () => {
    const redis = new Valkey();
    const duplicatedRedis = redis.duplicate();
    redis.options.port = 1234;
    expect(duplicatedRedis.options.port).to.eql(6379);
  });
});
