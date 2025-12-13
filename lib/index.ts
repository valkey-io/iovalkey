// eslint-disable-next-line import/extensions, @typescript-eslint/no-require-imports
exports = module.exports = require('./Redis.js').Redis as unknown as typeof import('./Redis.js').Redis;
export { Redis as default } from './Redis.js';
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
  RedisCommander,
  Result,
  ClientContext,
} from "./utils/RedisCommander.js";

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
export { RedisOptions, CommonRedisOptions } from "./redis/RedisOptions.js";
export { ClusterNode } from "./cluster/index.js";
export {
  ClusterOptions,
  DNSLookupFunction,
  DNSResolveSrvFunction,
  NatMap,
} from "./cluster/ClusterOptions.js";
export { NodeRole } from "./cluster/util.js";
export type {
  RedisKey,
  RedisValue,
  ChainableCommander,
} from "./utils/RedisCommander.js";
/**
 * @ignore
 */
export { print } from "./print.js";

// No TS typings
export { ReplyError } from "redis-errors";

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
