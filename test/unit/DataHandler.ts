import sinon from "sinon";
import { expect } from "chai";
import DataHandler from "../../lib/DataHandler";

describe("DataHandler", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("constructor()", () => {
    it("should add a data handler to the redis stream properly", () => {
      const dataHandledable = {
        stream: {
          prependListener: sinon.spy(),
          resume: sinon.spy(),
        },
      };
      new DataHandler(dataHandledable, {});

      expect(dataHandledable.stream.prependListener.calledOnce).to.eql(true);
      expect(dataHandledable.stream.resume.calledOnce).to.eql(true);

      expect(
        dataHandledable.stream.resume.calledAfter(
          dataHandledable.stream.prependListener
        )
      ).to.eql(true);
    });
  });
});
