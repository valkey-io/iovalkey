import Valkey from "../../lib/Valkey";
import { expect } from "chai";
import MockServer from "../helpers/mock_server";

describe("fatal_error", () => {
  it("should handle fatal error of parser", (done) => {
    let recovered = false;
    new MockServer(30000, (argv) => {
      if (recovered) {
        return;
      }
      if (argv[0] === "get") {
        return MockServer.raw("&");
      }
    });
    const redis = new Valkey(30000);
    redis.get("foo", function (err) {
      expect(err.message).to.match(/Protocol error/);

      recovered = true;
      redis.get("bar", function (err) {
        expect(err).to.eql(null);
        done();
      });
    });
  });
});
