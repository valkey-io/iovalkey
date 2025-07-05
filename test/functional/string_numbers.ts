import Valkey from "../../lib/Valkey";
import { expect } from "chai";

const MAX_NUMBER = 9007199254740991; // Number.MAX_SAFE_INTEGER

describe("stringNumbers", () => {
  context("enabled", () => {
    it("returns numbers as strings", async () => {
      const redis = new Valkey({
        stringNumbers: true,
      });

      await redis.set("foo", MAX_NUMBER);
      expect(await redis.incr("foo")).to.equal("9007199254740992");
      expect(await redis.incr("foo")).to.equal("9007199254740993");
      expect(await redis.incr("foo")).to.equal("9007199254740994");

      // also works for small integer
      await redis.set("foo", 123);
      expect(await redis.incr("foo")).to.equal("124");

      // and floats
      await redis.set("foo", 123.23);
      expect(Number(await redis.incrbyfloat("foo", 1.2))).to.be.within(
        124.42999,
        124.430001
      );

      redis.disconnect();
    });
  });

  context("disabled", () => {
    it("returns numbers", (done) => {
      const redis = new Valkey();

      redis.set("foo", "123");
      redis.incr("foo", function (err, res) {
        expect(res).to.eql(124);
        redis.disconnect();
        done();
      });
    });
  });
});
