import Valkey from "../../lib/Valkey";
import { expect } from "chai";

describe("watch-exec", () => {
  it("should support watch/exec transactions", () => {
    const redis1 = new Valkey();
    return redis1
      .watch("watchkey")
      .then(() => {
        return redis1.multi().set("watchkey", "1").exec();
      })
      .then(function (result) {
        expect(result.length).to.eql(1);
        expect(result[0]).to.eql([null, "OK"]);
      });
  });

  it("should support watch/exec transaction rollback", () => {
    const redis1 = new Valkey();
    const redis2 = new Valkey();
    return redis1
      .watch("watchkey")
      .then(() => {
        return redis2.set("watchkey", "2");
      })
      .then(() => {
        return redis1.multi().set("watchkey", "1").exec();
      })
      .then(function (result) {
        expect(result).to.be.null;
      });
  });
});
