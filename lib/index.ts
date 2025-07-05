// eslint-disable-next-line import/extensions, @typescript-eslint/no-require-imports
exports = module.exports = require('./Valkey.js').Valkey as unknown as typeof import('./Valkey.js').Valkey;
export { Valkey as default } from './Valkey.js';
export { Valkey } from './Valkey.js';

/**
 * @ignore
 */
export { Redis } from './Redis.js';

export { Cluster } from "./cluster/index.js";

/**
 * @ignore
 */
export { Command } from "./Command.js";

/**
 * @ignore
 */
export {
  ValkeyCommander, 
  Result,
  ClientContext,
} from "./utils/ValkeyCommander.js";

/**
 * @ignore
 * @deprecated Use ValkeyCommander instead.
 */
export { RedisCommander } from "./utils/RedisCommander.js";

/**
 * @ignore
 */
export { ScanStream } from "./ScanStream.js";

/**
 * @ignore
 */
export { Pipeline } from "./Pipeline.js";

/**
 * @ignore
 */
export { AbstractConnector } from "./connectors/AbstractConnector.js";

/**
 * @ignore
 */
export {
  SentinelConnector,
  SentinelIterator,
} from "./connectors/SentinelConnector/index.js";

/**
 * @ignore
 */
export { Callback } from "./types.js";

// Type Exports
export {
  SentinelAddress,
  SentinelConnectionOptions,
} from "./connectors/SentinelConnector/index.js";
export { StandaloneConnectionOptions } from "./connectors/StandaloneConnector.js";
export { ValkeyOptions, CommonValkeyOptions } from "./redis/ValkeyOptions.js";
/**
 * @ignore
 * @deprecated Use ValkeyOptions instead.
 */
export { RedisOptions } from "./redis/RedisOptions.js";
export { ClusterNode } from "./cluster/index.js";
export {
  ClusterOptions,
  DNSLookupFunction,
  DNSResolveSrvFunction,
  NatMap,
} from "./cluster/ClusterOptions.js";
export { NodeRole } from "./cluster/util.js";
export type {
  ValkeyKey,
  RedisValue,
  ChainableCommander,
} from "./utils/ValkeyCommander.js";
/**
 * @ignore
 */
export { print } from "./print.js";

// No TS typings
import * as RedisErrors from "redis-errors";
export const ReplyError: typeof RedisErrors.ReplyError = RedisErrors.ReplyError as unknown as typeof RedisErrors.ReplyError;

/**
 * @ignore
 */
Object.defineProperty(exports, "Promise", {
  get() {
    console.warn(
      "ioredis v5 does not support plugging third-party Promise library anymore. Native Promise will be used."
    );
    return Promise;
  },
  set(_lib: unknown) {
    console.warn(
      "ioredis v5 does not support plugging third-party Promise library anymore. Native Promise will be used."
    );
  },
});
