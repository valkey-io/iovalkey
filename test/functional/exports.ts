import ValkeyDefault, {
  Command,
  Cluster,
  Redis,
  ReplyError,
  Valkey,
} from "../../lib";
import { expect } from "chai";

describe("exports", () => {
  describe(".Valkey", () => {
    it("should alias the default and Redis exports", () => {
      expect(Valkey).to.equal(ValkeyDefault);
      expect(Valkey).to.equal(Redis);
      expect(Valkey).to.equal(require("../../lib"));
    });
  });

  describe(".Command", () => {
    it("should be `Command`", () => {
      expect(Command).to.eql(require("../../lib/Command").default);
    });
  });

  describe(".Cluster", () => {
    it("should be `Cluster`", () => {
      expect(Cluster).to.eql(require("../../lib/cluster").default);
    });
  });

  describe(".ReplyError", () => {
    it("should be `ReplyError`", () => {
      expect(ReplyError).to.eql(require("redis-errors").ReplyError);
    });
  });
});
