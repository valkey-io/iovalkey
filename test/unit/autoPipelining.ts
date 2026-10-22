import { expect } from "chai";
import * as sinon from "sinon";
import Pipeline from "../../lib/Pipeline";
import Redis from "../../lib/Redis";
import { getFirstValueInFlattenedArray } from "../../lib/autoPipelining";

describe("autoPipelining", function () {
  const expectGetFirstValueIs = (values, expected) => {
    expect(getFirstValueInFlattenedArray(values)).to.eql(expected);
  };

  it("should be able to efficiently get array args", function () {
    expectGetFirstValueIs([], undefined);
    expectGetFirstValueIs([null, "key"], null);
    expectGetFirstValueIs(["key", "value"], "key");
    expectGetFirstValueIs([[], "key"], "key");
    expectGetFirstValueIs([["key"]], "key");
    expectGetFirstValueIs([[["key"]]], ["key"]);
    expectGetFirstValueIs([0, 1, 2, 3, 4], 0);
    expectGetFirstValueIs([[true]], true);
    expectGetFirstValueIs([Buffer.from("test")], Buffer.from("test"));
    expectGetFirstValueIs([{}], {});
    // lodash.isArguments is true for this legacy js way to get argument lists
    const createArguments = function () {
      return arguments;
    };
    // @ts-expect-error
    expectGetFirstValueIs([createArguments(), createArguments("key")], "key");
    // @ts-expect-error
    expectGetFirstValueIs([createArguments("")], "");
  });

  it("should bucket string keys under a Buffer keyPrefix by their bytes", async function () {
    const redis = new Redis(30000, {
      enableAutoPipelining: true,
      lazyConnect: true,
      // keyPrefix is typed as a string, but a Buffer is supported
      keyPrefix: Buffer.from([0xff]) as unknown as string,
    });
    Object.defineProperty(redis, "isCluster", { value: true });
    // The prefixed keys' bytes hash to slots 12000 (node a) and 7811 (node
    // b). Every other slot is node b's, so only hashing those bytes splits
    // them.
    (redis as any).slots = new Array(16384).fill(["b"]);
    (redis as any).slots[12000] = ["a"];
    (redis as any)._groupsBySlot = new Array(16384);
    // Only the buckets are read here; the pipelines themselves are not run.
    const exec = sinon.stub(Pipeline.prototype, "exec").callsFake(function () {
      return Promise.resolve([]);
    });

    try {
      (redis as any).get("k0").catch(() => {});
      (redis as any).get("k3").catch(() => {});
      // One pipeline per node.
      expect([...(redis as any)._autoPipelines.keys()]).to.have.lengthOf(2);
      // Let the pipelines scheduled above run while exec is still stubbed.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      exec.restore();
      redis.disconnect();
    }
  });
});
