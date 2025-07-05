import { NetStream } from "../types.js";
import { Debug } from "../utils/index.js";

const debug = Debug("AbstractConnector");

type ErrorEmitter = (type: string, err: Error) => void;

abstract class AbstractConnector {
  firstError?: Error;
  protected connecting = false;
  protected stream: NetStream;
  private disconnectTimeout: number;

  constructor(disconnectTimeout: number) {
    this.disconnectTimeout = disconnectTimeout;
  }

  check(info: any): boolean {
    return true;
  }

  disconnect(): void {
    this.connecting = false;

    if (this.stream) {
      const stream = this.stream; // Make sure callbacks refer to the same instance

      const timeout = setTimeout(() => {
        debug(
          "stream %s:%s still open, destroying it",
          stream.remoteAddress,
          stream.remotePort
        );

        stream.destroy();
      }, this.disconnectTimeout);

      stream.on("close", () => clearTimeout(timeout));
      stream.end();
    }
  }

  abstract connect(_: ErrorEmitter): Promise<NetStream>;
}

export { AbstractConnector, ErrorEmitter };
export default AbstractConnector;