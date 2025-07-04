import { EventEmitter } from "events";
import { sample, Debug, noop, defaults } from "../utils/index.js";
import { ValkeyOptions, getNodeKey, NodeKey, NodeRole } from "./util.js";
import { Valkey } from "../Valkey.js";

const debug = Debug("cluster:connectionPool");

type NODE_TYPE = "all" | "master" | "slave";

type NodeRecord = {
  redis: Valkey;
  endListener: () => void;
  errorListener: (error: unknown) => void;
};

class ConnectionPool extends EventEmitter {  
  // master + slave = all
  private nodeRecords: { [key in NODE_TYPE]: { [key: string]: NodeRecord } } = {
    all: {},
    master: {},
    slave: {},
  };

  private specifiedOptions: { [key: string]: any } = {};

  constructor(private redisOptions) {
    super();
  }

  getNodes(role: NodeRole = "all"): Valkey[] {
    const nodeRecords = this.nodeRecords[role];
    return Object.keys(nodeRecords).map((key) => nodeRecords[key]?.redis);
  }

  getInstanceByKey(key: NodeKey): Valkey {
    return this.nodeRecords.all[key]?.redis;
  }

  getSampleInstance(role: NodeRole): Valkey {
    const keys = Object.keys(this.nodeRecords[role]);
    const sampleKey = sample(keys);
    return this.nodeRecords[role][sampleKey]?.redis;
  }

  /**
   * Find or create a connection to the node
   */
  findOrCreate(redisOptions: ValkeyOptions, readOnly = false): NodeRecord {
    const key = getNodeKey(redisOptions);
    readOnly = Boolean(readOnly);

    if (this.specifiedOptions[key]) {
      Object.assign(redisOptions, this.specifiedOptions[key]);
    } else {
      this.specifiedOptions[key] = redisOptions;
    }

    let nodeRecord: NodeRecord;
    if (this.nodeRecords.all[key]) {
      nodeRecord = this.nodeRecords.all[key];
      if (nodeRecord.redis.options.readOnly !== readOnly) {
        nodeRecord.redis.options.readOnly = readOnly;
        debug("Change role of %s to %s", key, readOnly ? "slave" : "master");
        nodeRecord.redis[readOnly ? "readonly" : "readwrite"]().catch(noop);
        if (readOnly) {
          delete this.nodeRecords.master[key];
          this.nodeRecords.slave[key] = nodeRecord;
        } else {
          delete this.nodeRecords.slave[key];
          this.nodeRecords.master[key] = nodeRecord;
        }
      }
    } else {
      debug("Connecting to %s as %s", key, readOnly ? "slave" : "master");
      const redis = new Valkey(
        defaults(
          {
            // Never try to reconnect when a node is lose,
            // instead, waiting for a `MOVED` error and
            // fetch the slots again.
            retryStrategy: null,
            // Offline queue should be enabled so that
            // we don't need to wait for the `ready` event
            // before sending commands to the node.
            enableOfflineQueue: true,
            readOnly: readOnly,
          },
          redisOptions,
          this.redisOptions,
          { lazyConnect: true }
        )
      );
      const endListener = () => {
        this.removeNode(key);
      };
      const errorListener = (error: unknown) => {
        this.emit("nodeError", error, key);
      };
      nodeRecord = { redis, endListener, errorListener };

      this.nodeRecords.all[key] = nodeRecord;
      this.nodeRecords[readOnly ? "slave" : "master"][key] = nodeRecord;

      redis.once("end", endListener);

      this.emit("+node", redis, key);

      redis.on("error", errorListener);
    }

    return nodeRecord;
  }

  /**
   * Reset the pool with a set of nodes.
   * The old node will be removed.
   */
  reset(nodes: ValkeyOptions[]): void {
    debug("Reset with %O", nodes);
    const newNodes = {};
    nodes.forEach((node) => {
      const key = getNodeKey(node);

      // Don't override the existing (master) node
      // when the current one is slave.
      if (!(node.readOnly && newNodes[key])) {
        newNodes[key] = node;
      }
    });

    Object.keys(newNodes).forEach((key) => {
      const node = newNodes[key];
      this.findOrCreate(node, node.readOnly);
    });
    Object.keys(this.nodeRecords.all).forEach((key) => {
      if (!newNodes[key]) {
        debug("Disconnect %s because the node does not hold any slot", key);
        this.nodeRecords.all[key].redis.disconnect();
        this.removeNode(key);
      }
    });
  }

  /**
   * Remove a node from the pool.
   */
  private removeNode(key: string): void {
    const { nodeRecords } = this;
    const nodeRecord = nodeRecords.all[key];
    if (nodeRecord) {
      debug("Remove %s from the pool", key);
      nodeRecord.redis.removeListener("end", nodeRecord.endListener);
      nodeRecord.redis.removeListener("error", nodeRecord.errorListener);
      delete nodeRecords.all[key];
      delete nodeRecords.master[key];
      delete nodeRecords.slave[key];

      this.emit("-node", nodeRecord.redis, key);
      if (!Object.keys(nodeRecords.all).length) {
        this.emit("drain");
      }
    }
  }
}

export { ConnectionPool };
export default ConnectionPool;