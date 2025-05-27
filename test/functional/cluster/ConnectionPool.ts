import { expect } from "chai";

import ConnectionPool from "../../../lib/cluster/ConnectionPool";

describe("The cluster connection pool", () => {
  describe("when not connected", () => {
    it("does not throw when fetching a sample node", () => {
      expect(new ConnectionPool({}).getSampleInstance("all")).to.be.undefined;
      expect(new ConnectionPool({}).getNodes("all")).to.be.eq([]);
    });
  });
});
