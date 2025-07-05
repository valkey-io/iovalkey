import Valkey from "../../lib/Valkey";
import { expect } from "chai";

const path = require("path");
const scriptName = path.basename(__filename);

describe("showFriendlyErrorStack", () => {
  it("should show friendly error stack", (done) => {
    const redis = new Valkey({ showFriendlyErrorStack: true });
    redis.set("foo").catch(function (err) {
      const errors = err.stack.split("\n");
      expect(errors[0].indexOf("ReplyError")).not.eql(-1);
      expect(errors[1].indexOf(scriptName)).not.eql(-1);
      done();
    });
  });
});
