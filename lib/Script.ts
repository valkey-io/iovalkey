import { createHash } from "crypto";
import Command from "./Command";
import asCallback from "standard-as-callback";
import { Callback } from "./types";
export default class Script {
  private sha: string;
  private Command: new (...args: any[]) => Command;

  constructor(
    private lua: string,
    private numberOfKeys: number | null = null,
    private keyPrefix: string = "",
    private readOnly: boolean = false
  ) {
    this.sha = createHash("sha1").update(lua).digest("hex");

    const sha = this.sha;
    const socketHasScriptLoaded = new WeakSet();
    this.Command = class CustomScriptCommand extends Command {
      private _scriptSocket?: object;
      private _scriptInlined = false;

      toWritable(socket: object): string | Buffer {
        const origReject = this.reject;
        this.reject = (err) => {
          if (err.message.indexOf("NOSCRIPT") !== -1) {
            socketHasScriptLoaded.delete(socket);
          }
          origReject.call(this, err);
        };

        this._scriptSocket = socket;
        this._scriptInlined = false;
        if (!socketHasScriptLoaded.has(socket)) {
          // The mark is provisional: only the reply to this write proves
          // whether the EVAL body actually ran on the server.
          this._scriptInlined = true;
          this.name = "eval";
          this.args[0] = lua;
          socketHasScriptLoaded.add(socket);
        } else if (this.name === "eval") {
          this.name = "evalsha";
          this.args[0] = sha;
        }
        return super.toWritable(socket);
      }

      transformReply(result: Buffer | Buffer[]) {
        if (this._scriptInlined) {
          if (String(result) === "QUEUED") {
            // The command was queued by MULTI, not run: if the
            // transaction is discarded the script is never cached.
            socketHasScriptLoaded.delete(this._scriptSocket);
          } else {
            socketHasScriptLoaded.add(this._scriptSocket);
          }
        }
        return super.transformReply(result);
      }
    };
  }

  execute(container: any, args: any[], options: any, callback?: Callback) {
    if (typeof this.numberOfKeys === "number") {
      args.unshift(this.numberOfKeys);
    }
    if (this.keyPrefix) {
      options.keyPrefix = this.keyPrefix;
    }
    if (this.readOnly) {
      options.readOnly = true;
    }

    const evalsha = new this.Command("evalsha", [this.sha, ...args], options);

    evalsha.promise = evalsha.promise.catch((err: Error) => {
      if (err.message.indexOf("NOSCRIPT") === -1) {
        throw err;
      }

      // Resend the same custom evalsha command that gets transformed
      // to an eval in case it's not loaded yet on the connection.
      const resend = new this.Command("evalsha", [this.sha, ...args], options);

      const client = container.isPipeline ? container.redis : container;
      return client.sendCommand(resend);
    });

    asCallback(evalsha.promise, callback);
    return container.sendCommand(evalsha);
  }
}
