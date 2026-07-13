import { Debug } from "../utils";
import { getNodeKey, RedisOptions } from "./util";
import * as calculateSlot from "cluster-key-slot";
import * as EventEmitter from "events";
import ShardedSubscriber from "./ShardedSubscriber";
import { ClusterOptions } from "./ClusterOptions";
const debug = Debug("cluster:subscriberGroup");

/**
 * Redis distinguishes between "normal" and sharded PubSub. When using the normal PubSub feature,
 * exactly one subscriber exists per cluster instance because the Redis cluster bus forwards
 * messages between shards. Sharded PubSub removes this limitation by making each shard
 * responsible for its own messages.
 *
 * This class coordinates one ShardedSubscriber per master node in the cluster, providing
 * sharded PubSub support while keeping the public API backward compatible.
 */
export default class ClusterSubscriberGroup {
  private static readonly MAX_RETRY_ATTEMPTS = 10;
  private static readonly MAX_BACKOFF_MS = 2000;
  private static readonly BASE_BACKOFF_MS = 100;

  private shardedSubscribers: Map<string, ShardedSubscriber> = new Map();
  private clusterSlots: string[][] = [];
  // Simple [min, max] slot ranges aren't enough because you can migrate single slots
  private subscriberToSlotsIndex: Map<string, number[]> = new Map();
  private channels: Map<number, Map<string, string | Buffer>> = new Map();
  private failedAttemptsByNode: Map<string, number> = new Map();
  private nodeOptionsByKey: Map<string, RedisOptions> = new Map();
  private staleOwnersBySlot: Map<number, Set<string>> = new Map();
  private staleChannelsByNode: Map<string, Map<string, string | Buffer>> =
    new Map();

  // Only latest pending reset kept; throttled by refreshSlotsCache's isRefreshing + backoff delay
  private isResetting = false;
  private pendingReset: { slots: string[][]; nodes: any[] } | null = null;
  private lifecycleEpoch = 0;

  /**
   * Register callbacks
   *
   * @param cluster
   */
  constructor(
    private readonly subscriberGroupEmitter: EventEmitter,
    private readonly options: ClusterOptions
  ) {}

  /**
   * Get the responsible subscriber.
   *
   * @param slot
   */
  getResponsibleSubscriber(slot: number): ShardedSubscriber | undefined {
    const nodeKey = this.clusterSlots[slot]?.[0];
    if (!nodeKey) {
      return undefined;
    }

    const sub = this.getOrCreateSubscriber(nodeKey);
    if (sub && sub.subscriberStatus === "idle") {
      sub
        .start()
        .then(() => {
          this.handleSubscriberConnectSucceeded(sub.getNodeKey());
        })
        .catch((err) => {
          this.handleSubscriberConnectFailed(err, sub.getNodeKey());
        });
    }

    return sub;
  }

  updateSlotOwner(slot: number, nodeKey: string, options: RedisOptions): void {
    const previousNodeKey = this.clusterSlots[slot]?.[0];
    this.clusterSlots[slot] = [nodeKey];
    this.nodeOptionsByKey.set(nodeKey, options);

    if (previousNodeKey && previousNodeKey !== nodeKey) {
      const staleOwners = this.staleOwnersBySlot.get(slot) || new Set();
      staleOwners.add(previousNodeKey);
      this.staleOwnersBySlot.set(slot, staleOwners);

      const staleChannels =
        this.staleChannelsByNode.get(previousNodeKey) || new Map();
      for (const [key, channel] of this.channels.get(slot) || []) {
        staleChannels.set(key, channel);
      }
      this.staleChannelsByNode.set(previousNodeKey, staleChannels);

      const previousSlots = this.subscriberToSlotsIndex.get(previousNodeKey);
      if (previousSlots) {
        this.subscriberToSlotsIndex.set(
          previousNodeKey,
          previousSlots.filter((candidate) => candidate !== slot)
        );
      }
    }
    const targetSlots = this.subscriberToSlotsIndex.get(nodeKey) || [];
    if (!targetSlots.includes(slot)) {
      targetSlots.push(slot);
      this.subscriberToSlotsIndex.set(nodeKey, targetSlots);
    }
  }

  validateChannels(channels: (string | Buffer)[]): boolean {
    if (channels.length === 0) {
      return false;
    }
    const slot = calculateSlot(channels[0]);
    return channels.every((channel) => calculateSlot(channel) === slot);
  }

  /**
   * Adds a channel for which this subscriber group is responsible
   *
   * @param channels
   */
  addChannels(channels: (string | Buffer)[]): number {
    if (!this.validateChannels(channels)) {
      return -1;
    }

    const slot = calculateSlot(channels[0]);
    let slotChannels = this.channels.get(slot);
    if (!slotChannels) {
      slotChannels = new Map();
      this.channels.set(slot, slotChannels);
    }
    for (const channel of channels) {
      slotChannels.set(this.channelKey(channel), channel);
    }

    return this.channelCount();
  }

  /**
   * Removes channels for which the subscriber group is responsible by optionally unsubscribing
   * @param channels
   */
  removeChannels(channels: (string | Buffer)[]): number {
    if (!this.validateChannels(channels)) {
      return -1;
    }

    const slot = calculateSlot(channels[0]);
    const slotChannels = this.channels.get(slot);
    if (slotChannels) {
      for (const channel of channels) {
        slotChannels.delete(this.channelKey(channel));
      }
      if (slotChannels.size === 0) {
        this.channels.delete(slot);
      }
    }

    this.pruneSubscribers();
    return this.channelCount();
  }

  async unsubscribeAll(): Promise<number> {
    const pending: Promise<unknown>[] = [];
    for (const subscriber of this.shardedSubscribers.values()) {
      const redis = subscriber.getInstance();
      if (redis && subscriber.isStarted()) {
        pending.push(redis.sunsubscribe());
      }
    }

    await Promise.all(pending);
    this.channels.clear();
    this.pruneSubscribers();
    return 0;
  }

  /**
   * Disconnect all subscribers and clear some of the internal state.
   */
  stop() {
    for (const s of this.shardedSubscribers.values()) {
      s.stop();
    }

    // Clear subscriber instances and pending operations.
    // Channels are preserved for resubscription on reconnect.
    this.lifecycleEpoch += 1;
    this.pendingReset = null;
    this.shardedSubscribers.clear();
    this.subscriberToSlotsIndex.clear();
    this.nodeOptionsByKey.clear();
    this.failedAttemptsByNode.clear();
    this.staleOwnersBySlot.clear();
    this.staleChannelsByNode.clear();
  }

  /**
   * Start all not yet started subscribers
   */
  start() {
    const startPromises = [];
    for (const s of this.shardedSubscribers.values()) {
      if (this.shouldStartSubscriber(s)) {
        startPromises.push(
          s
            .start()
            .then(() => {
              this.handleSubscriberConnectSucceeded(s.getNodeKey());
            })
            .catch((err) => {
              this.handleSubscriberConnectFailed(err, s.getNodeKey());
            })
        );

        this.subscriberGroupEmitter.emit("+subscriber");
      }
    }
    return Promise.all(startPromises);
  }

  /**
   * Resets the subscriber group by disconnecting all subscribers that are no longer needed and connecting new ones.
   */
  async reset(clusterSlots: string[][], clusterNodes: any[]): Promise<void> {
    if (this.isResetting) {
      this.pendingReset = { slots: clusterSlots, nodes: clusterNodes };
      return;
    }

    this.isResetting = true;
    const lifecycleEpoch = this.lifecycleEpoch;

    try {
      this.nodeOptionsByKey = new Map(
        clusterNodes.map((node) => [getNodeKey(node.options), node.options])
      );
      const previousSlots = this.clusterSlots.map((nodes) => nodes?.slice());
      const staleOwnersBySlot = this.staleOwnersBySlot;
      const staleChannelsByNode = this.staleChannelsByNode;
      this.staleOwnersBySlot = new Map();
      this.staleChannelsByNode = new Map();
      const hasTopologyChanged = this._refreshSlots(clusterSlots);
      const hasFailedSubscribers = this.hasUnhealthySubscribers();

      if (
        !hasTopologyChanged &&
        !hasFailedSubscribers &&
        staleOwnersBySlot.size === 0 &&
        staleChannelsByNode.size === 0
      ) {
        debug(
          "No topology change detected or failed subscribers. Skipping reset."
        );
        return;
      }

      if (hasTopologyChanged || staleOwnersBySlot.size > 0) {
        await this.unsubscribeMovedChannels(
          previousSlots,
          staleOwnersBySlot,
          staleChannelsByNode
        );
      }
      if (lifecycleEpoch !== this.lifecycleEpoch) {
        return;
      }

      // For each of the sharded subscribers
      for (const [nodeKey, shardedSubscriber] of this.shardedSubscribers) {
        if (
          // If the subscriber is still responsible for a slot range and is healthy then keep it
          this.subscriberToSlotsIndex.has(nodeKey) &&
          this.nodeHasChannels(nodeKey) &&
          shardedSubscriber.isHealthy()
        ) {
          debug("Skipping deleting subscriber for %s", nodeKey);
          continue;
        }

        debug("Removing subscriber for %s", nodeKey);
        // Otherwise stop the subscriber and remove it
        shardedSubscriber.stop();
        this.shardedSubscribers.delete(nodeKey);

        this.subscriberGroupEmitter.emit("-subscriber");
      }

      const startPromises = [];
      // For each node in slots cache
      for (const nodeKey of this.subscriberToSlotsIndex.keys()) {
        if (!this.nodeHasChannels(nodeKey)) {
          continue;
        }
        const existingSubscriber = this.shardedSubscribers.get(nodeKey);

        // If we already have a subscriber for this node, only ensure it is healthy
        // when it now owns slots with active channel subscriptions.
        if (existingSubscriber && existingSubscriber.isHealthy()) {
          debug("Skipping creating new subscriber for %s", nodeKey);

          if (
            !existingSubscriber.isStarted() &&
            this.shouldStartSubscriber(existingSubscriber)
          ) {
            startPromises.push(
              existingSubscriber
                .start()
                .then(() => {
                  this.handleSubscriberConnectSucceeded(nodeKey);
                })
                .catch((error) => {
                  this.handleSubscriberConnectFailed(error, nodeKey);
                })
            );
          }

          continue;
        }

        // If we have an existing subscriber but it is not healthy, stop it
        if (existingSubscriber && !existingSubscriber.isHealthy()) {
          debug("Replacing subscriber for %s", nodeKey);
          existingSubscriber.stop();
          this.shardedSubscribers.delete(nodeKey);
          this.subscriberGroupEmitter.emit("-subscriber");
        }

        debug("Creating new subscriber for %s", nodeKey);
        const sub = this.getOrCreateSubscriber(nodeKey);
        if (!sub) {
          debug("Failed to find node options for key %s", nodeKey);
          continue;
        }

        if (this.shouldStartSubscriber(sub)) {
          startPromises.push(
            sub
              .start()
              .then(() => {
                this.handleSubscriberConnectSucceeded(nodeKey);
              })
              .catch((error) => {
                this.handleSubscriberConnectFailed(error, nodeKey);
              })
          );
        }
      }

      // It's vital to await the start promises before resubscribing
      // Otherwise we might try to resubscribe to a subscriber that is not yet connected
      // This can cause a race condition
      await Promise.all(startPromises);
      if (lifecycleEpoch !== this.lifecycleEpoch) {
        return;
      }

      this._resubscribe();
      this.subscriberGroupEmitter.emit("subscribersReady");
    } finally {
      this.isResetting = false;
      if (this.pendingReset) {
        const { slots, nodes } = this.pendingReset;
        this.pendingReset = null;
        await this.reset(slots, nodes);
      }
    }
  }

  /**
   * Refreshes the subscriber-related slot ranges
   *
   * Returns false if no refresh was needed
   *
   * @param targetSlots
   */
  private _refreshSlots(targetSlots: string[][]): boolean {
    //If there was an actual change, then reassign the slot ranges
    // Also rebuild if subscriberToSlotsIndex is empty (e.g., after stop() was called)
    if (
      this._slotsAreEqual(targetSlots) &&
      this.subscriberToSlotsIndex.size > 0
    ) {
      debug(
        "Nothing to refresh because the new cluster map is equal to the previous one."
      );

      return false;
    }

    debug("Refreshing the slots of the subscriber group.");

    //Rebuild the slots index
    this.subscriberToSlotsIndex = new Map();

    for (let slot = 0; slot < targetSlots.length; slot++) {
      const node: string = targetSlots[slot][0];

      if (!this.subscriberToSlotsIndex.has(node)) {
        this.subscriberToSlotsIndex.set(node, []);
      }
      this.subscriberToSlotsIndex.get(node).push(Number(slot));
    }

    //Update the cached slots map
    this.clusterSlots = JSON.parse(JSON.stringify(targetSlots));

    return true;
  }

  /**
   * Resubscribes to the previous channels
   *
   * @private
   */
  private _resubscribe() {
    if (this.shardedSubscribers) {
      this.shardedSubscribers.forEach(
        (s: ShardedSubscriber, nodeKey: string) => {
          const subscriberSlots = this.subscriberToSlotsIndex.get(nodeKey);
          if (subscriberSlots) {
            //Resubscribe on the underlying connection
            subscriberSlots.forEach((ss) => {
              //Might return null if being disconnected
              const redis = s.getInstance();
              const slotChannels = this.channels.get(ss);
              const channels = slotChannels
                ? Array.from(slotChannels.values())
                : [];

              if (channels.length > 0) {
                if (!redis || redis.status === "end") {
                  return;
                }

                if (redis.status === "ready") {
                  redis.ssubscribe(...channels).catch((err) => {
                    debug("Failed to ssubscribe on node %s: %s", nodeKey, err);
                    this.handleSubscriberConnectFailed(err, nodeKey);
                  });
                } else {
                  redis.once("ready", () => {
                    redis.ssubscribe(...channels).catch((err) => {
                      debug(
                        "Failed to ssubscribe on node %s: %s",
                        nodeKey,
                        err
                      );
                      this.handleSubscriberConnectFailed(err, nodeKey);
                    });
                  });
                }
              }
            });
          }
        }
      );
    }
  }

  /**
   * Deep equality of the cluster slots objects
   *
   * @param other
   * @private
   */
  private _slotsAreEqual(other: string[][]) {
    if (this.clusterSlots === undefined) {
      return false;
    } else {
      return JSON.stringify(this.clusterSlots) === JSON.stringify(other);
    }
  }

  /**
   * Checks if any subscribers are in an unhealthy state.
   *
   * A subscriber is considered unhealthy if:
   * - It exists but is not started (failed/disconnected)
   * - It's missing entirely for a node that should have one
   *
   * @returns true if any subscribers need to be recreated
   */
  private hasUnhealthySubscribers(): boolean {
    const hasFailedSubscribers = Array.from(
      this.shardedSubscribers.values()
    ).some((sub) => !sub.isHealthy());

    const hasMissingSubscribers = Array.from(
      this.subscriberToSlotsIndex.keys()
    ).some((nodeKey) => !this.shardedSubscribers.has(nodeKey));

    return hasFailedSubscribers || hasMissingSubscribers;
  }

  /**
   * Handles failed subscriber connections by emitting an event to refresh the slots cache
   * after a backoff period.
   *
   * @param error
   * @param nodeKey
   */
  private handleSubscriberConnectFailed = (error: Error, nodeKey: string) => {
    const currentAttempts = this.failedAttemptsByNode.get(nodeKey) || 0;
    const failedAttempts = currentAttempts + 1;
    this.failedAttemptsByNode.set(nodeKey, failedAttempts);

    const attempts = Math.min(
      failedAttempts,
      ClusterSubscriberGroup.MAX_RETRY_ATTEMPTS
    );
    const backoff = Math.min(
      ClusterSubscriberGroup.BASE_BACKOFF_MS * 2 ** attempts,
      ClusterSubscriberGroup.MAX_BACKOFF_MS
    );
    const jitter = Math.floor((Math.random() - 0.5) * (backoff * 0.5));
    const delay = Math.max(0, backoff + jitter);

    debug(
      "Failed to connect subscriber for %s. Refreshing slots in %dms",
      nodeKey,
      delay
    );

    this.subscriberGroupEmitter.emit("subscriberConnectFailed", {
      delay,
      error,
    });
  };

  /**
   * Handles successful subscriber connections by resetting the failed attempts counter.
   *
   * @param nodeKey
   */
  private handleSubscriberConnectSucceeded = (nodeKey: string) => {
    this.failedAttemptsByNode.delete(nodeKey);
  };

  private shouldStartSubscriber(sub: ShardedSubscriber): boolean {
    if (sub.isStarted()) {
      return false;
    }

    if (!sub.isLazyConnect()) {
      return true;
    }

    const subscriberSlots = this.subscriberToSlotsIndex.get(sub.getNodeKey());

    if (!subscriberSlots) {
      return false;
    }

    return subscriberSlots.some((slot) => {
      const channels = this.channels.get(slot);
      return Boolean(channels && channels.size > 0);
    });
  }

  private getOrCreateSubscriber(
    nodeKey: string
  ): ShardedSubscriber | undefined {
    const existing = this.shardedSubscribers.get(nodeKey);
    if (existing) {
      return existing;
    }

    const options = this.nodeOptionsByKey.get(nodeKey);
    if (!options) {
      return undefined;
    }

    const subscriber = new ShardedSubscriber(
      this.subscriberGroupEmitter,
      options,
      this.options.redisOptions
    );
    this.shardedSubscribers.set(nodeKey, subscriber);
    this.subscriberGroupEmitter.emit("+subscriber");
    return subscriber;
  }

  private nodeHasChannels(nodeKey: string): boolean {
    const slots = this.subscriberToSlotsIndex.get(nodeKey) || [];
    return slots.some((slot) => Boolean(this.channels.get(slot)?.size));
  }

  private pruneSubscribers(): void {
    for (const [nodeKey, subscriber] of this.shardedSubscribers) {
      if (!this.nodeHasChannels(nodeKey)) {
        subscriber.stop();
        this.shardedSubscribers.delete(nodeKey);
        this.subscriberGroupEmitter.emit("-subscriber");
      }
    }
  }

  private async unsubscribeMovedChannels(
    previousSlots: string[][],
    staleOwnersBySlot: Map<number, Set<string>>,
    staleChannelsByNode: Map<string, Map<string, string | Buffer>>
  ): Promise<void> {
    const channelsByPreviousNode = new Map<string, Array<string | Buffer>>(
      Array.from(staleChannelsByNode, ([nodeKey, channels]) => [
        nodeKey,
        Array.from(channels.values()),
      ])
    );
    for (const [slot, slotChannels] of this.channels) {
      const currentNodeKey = this.clusterSlots[slot]?.[0];
      const previousNodeKeys = new Set<string>(
        staleOwnersBySlot.get(slot) || []
      );
      const previousNodeKey = previousSlots[slot]?.[0];
      if (previousNodeKey) {
        previousNodeKeys.add(previousNodeKey);
      }

      for (const nodeKey of previousNodeKeys) {
        if (nodeKey === currentNodeKey) {
          continue;
        }
        const channels = channelsByPreviousNode.get(nodeKey) || [];
        channels.push(...slotChannels.values());
        channelsByPreviousNode.set(nodeKey, channels);
      }
    }

    await Promise.all(
      Array.from(channelsByPreviousNode, async ([nodeKey, channels]) => {
        const subscriber = this.shardedSubscribers.get(nodeKey);
        const redis = subscriber?.getInstance();
        if (!subscriber || !redis || !subscriber.isStarted()) {
          return;
        }
        try {
          await redis.sunsubscribe(...channels);
        } catch (error) {
          subscriber.stop();
          this.shardedSubscribers.delete(nodeKey);
          this.subscriberGroupEmitter.emit("-subscriber");
          this.subscriberGroupEmitter.emit("nodeError", error, nodeKey);
        }
      })
    );
  }

  private channelKey(channel: string | Buffer): string {
    return Buffer.from(channel).toString("base64");
  }

  private channelCount(): number {
    return Array.from(this.channels.values()).reduce(
      (sum, channels) => sum + channels.size,
      0
    );
  }
}
