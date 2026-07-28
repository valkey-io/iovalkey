import { expect } from "chai";
import { EventEmitter } from "events";
import ClusterSubscriberGroup from "../../../lib/cluster/ClusterSubscriberGroup";

describe("ClusterSubscriberGroup", () => {
  it("deduplicates channels and removes equivalent buffers", () => {
    const group = new ClusterSubscriberGroup(new EventEmitter(), {});

    expect(group.addChannels([Buffer.from("channel")])).to.equal(1);
    expect(group.addChannels([Buffer.from("channel")])).to.equal(1);
    expect(group.removeChannels([Buffer.from("channel")])).to.equal(0);
  });

  it("rejects channels from different slots", () => {
    const group = new ClusterSubscriberGroup(new EventEmitter(), {});

    expect(group.addChannels(["foo", "bar"])).to.equal(-1);
  });
});
