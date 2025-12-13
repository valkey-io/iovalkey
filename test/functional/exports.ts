import { Command, Cluster, ReplyError, Valkey } from "../../lib";
import { expect } from "chai";

describe("exports", () => {
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

  describe(".Valkey", () => {
    it("should be `Valkey`", () => {
      expect(Valkey).to.eql(require("../../lib").default);
    });
  });
});
