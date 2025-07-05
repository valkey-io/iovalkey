import net from "net";
import tls from "tls";
import { StandaloneConnector } from "../../../lib/connectors";
import sinon from "sinon";
import { expect } from "chai";

describe("StandaloneConnector", () => {
  describe("connect()", () => {
    it("first tries path", async () => {
      const spy = sinon.spy(net, "createConnection");
      const connector = new StandaloneConnector({ port: 6379, path: "/tmp" });
      try {
        const stream = await connector.connect(() => {});
        stream.on("error", () => {});
      } catch (err) {
        // ignore errors
      }
      expect(spy.calledOnce).to.eql(true);
      connector.disconnect();
    });

    it("ignore path when port is set and path is null", async () => {
      const spy = sinon.spy(net, "createConnection");
      const connector = new StandaloneConnector({ port: 6379, path: null });
      await connector.connect(() => {});
      expect(spy.calledOnce).to.eql(true);
      expect(spy.firstCall.args[0]).to.eql({ port: 6379 });
      connector.disconnect();
    });

    it("supports tls", async () => {
      const spy = sinon.spy(tls, "connect");
      const connector = new StandaloneConnector({
        port: 6379,
        tls: { ca: "on", servername: "localhost", rejectUnauthorized: false },
      });
      await connector.connect(() => {});
      expect(spy.calledOnce).to.eql(true);
      expect(spy.firstCall.args[0]).to.eql({
        port: 6379,
        ca: "on",
        servername: "localhost",
        rejectUnauthorized: false,
      });
      connector.disconnect();
    });
  });
});
