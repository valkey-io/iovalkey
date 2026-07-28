# Sharded Pub/Sub routing

Status: initial contributor design

Issue: [#13](https://github.com/valkey-io/iovalkey/issues/13)

## Problem

Valkey Cluster routes a sharded Pub/Sub channel by its hash slot. `SPUBLISH`, `SSUBSCRIBE`, and `SUNSUBSCRIBE` for a channel must reach the primary that owns that slot.

The cluster client currently uses one randomly selected `ClusterSubscriber` for every subscription command. This works for `SUBSCRIBE` and `PSUBSCRIBE` because classic Pub/Sub messages are propagated across the cluster. It does not work for sharded Pub/Sub: an `SSUBSCRIBE` sent to one shard cannot receive an `SPUBLISH` routed to another shard.

The existing functional test hides the defect by injecting an `smessage` directly into the selected subscriber connection instead of publishing through the cluster.

## Goals

- Route `SSUBSCRIBE` and `SUNSUBSCRIBE` by channel slot ownership.
- Keep classic `SUBSCRIBE`, `PSUBSCRIBE`, and their message events unchanged.
- Preserve sharded subscriptions across slot refreshes, failover, and reconnects.
- Forward `smessage` and `smessageBuffer` through the `Cluster` instance.
- Open sharded subscriber connections lazily and close all of them on disconnect.
- Add an end-to-end regression test that uses `SPUBLISH` against an actual Valkey Cluster rather than injecting a message.
- Make the same containerized integration test runnable locally and in a dedicated GitHub Actions job.

## Non-goals

- Delivery guarantees beyond those provided by Valkey Pub/Sub.
- Pattern subscriptions for sharded Pub/Sub; Valkey does not provide them.
- Changes to normal command, pipeline, or `SPUBLISH` routing. `SPUBLISH` already follows the command's key slot through the regular cluster path.

## Proposed design

Keep the existing `ClusterSubscriber` exclusively for classic Pub/Sub. Add two internal components for sharded Pub/Sub:

- `ClusterSubscriberGroup` owns the channel-to-slot registry and coordinates subscribers as cluster topology changes.
- `ShardedSubscriber` owns one dedicated `Redis` connection to one primary and forwards sharded message events.

The group maintains:

```text
channelsBySlot: slot -> subscribed channels
subscribersByNode: primary node key -> ShardedSubscriber
slots: slot -> current primary node key
```

There is at most one sharded subscriber per primary with active channels. Connections use `lazyConnect`, have offline queueing enabled, and do not independently reconnect. The group owns reconnection so that a stale connection cannot continue subscribing to a node that no longer owns the slot.

The feature should activate automatically on the first sharded subscription. A new public option is unnecessary when no sharded connections are opened until they are used.

## Command routing

Handle sharded subscription commands before the generic subscriber-mode branch in `Cluster#sendCommand`:

1. Calculate the slot from the first channel.
2. Reject an explicit multi-channel command if its channels do not share a slot.
3. Resolve the primary from the current slot cache.
4. Get or create that primary's `ShardedSubscriber`.
5. Send the command through its dedicated connection.
6. Update `channelsBySlot` only when the command succeeds.

`SUNSUBSCRIBE` without channels must be fanned out to every active sharded subscriber and clear the registry. Its callback/promise should resolve once all underlying commands settle, returning the client-wide remaining subscription count.

If no owner is available, reject with a cluster error rather than falling back to a random subscriber.

## Topology and connection lifecycle

After every successful slots-cache refresh, the group compares each subscribed slot's previous and current owner:

- unchanged owners retain their subscriber and subscriptions;
- changed owners get a subscriber connection and are re-subscribed to the slot's channels;
- subscribers with no remaining channels are stopped and removed.

A `MOVED` reply or an unexpected sharded-subscriber disconnect triggers a slots refresh using the cluster's existing refresh deduplication and retry policy. After refresh, the group rebuilds only the affected subscribers. Concurrent refreshes must not create duplicate connections or duplicate resubscription work.

`Cluster#disconnect()` and `Cluster#quit()` stop both the classic subscriber and every sharded subscriber. A later `connect()` rebuilds sharded subscribers from the retained channel registry, matching existing resubscription behavior.

## Expected code changes

- Add `lib/cluster/ClusterSubscriberGroup.ts`.
- Add `lib/cluster/ShardedSubscriber.ts`.
- Integrate the group into `lib/cluster/index.ts` command routing, slot refresh, connect, and disconnect paths.
- Keep `lib/cluster/ClusterSubscriber.ts` focused on classic Pub/Sub.
- Replace the misleading mock assertion in `test/functional/cluster/spub_ssub.ts` and add fast routing, recovery, and cleanup coverage.
- Add actual-cluster tests under `test/cluster/` and a local Docker launcher under `test/cluster/docker-valkey/`.
- Add `test:js:valkey-cluster` and `test:integration:valkey-cluster` package scripts.
- Add a dedicated `test-valkey-cluster` job to `.github/workflows/test.yml`.

The implementation adapts the subscriber-group architecture from ioredis PRs [#1956](https://github.com/redis/ioredis/pull/1956), [#2013](https://github.com/redis/ioredis/pull/2013), [#2043](https://github.com/redis/ioredis/pull/2043), [#2060](https://github.com/redis/ioredis/pull/2060), and [#2090](https://github.com/redis/ioredis/pull/2090). The original work was authored by David Maier and Tihomir Krasimirov Mateev, then evolved by Pavel Pashov and Hristo Temelski. It is adapted rather than cherry-picked wholesale because iovalkey's connection-pool and recovery code has diverged. The implementation commit must retain their `Co-authored-by` trailers.

## Test plan

### Fast tests

1. Use two mock primaries with different slot ranges and verify `SSUBSCRIBE` is sent to the channel's owner.
2. Verify channels in the same slot share a subscriber and channels on different primaries use different subscribers.
3. Verify a multi-channel cross-slot `SSUBSCRIBE` is rejected before changing internal state.
4. Change the mocked slot owner and verify resubscription on the new primary.
5. Disconnect a sharded subscriber and verify bounded recovery without affecting classic subscriptions.
6. Verify no sharded connection is opened before `SSUBSCRIBE`.
7. Verify `SUNSUBSCRIBE` with and without channel arguments updates all relevant subscribers.
8. Verify `disconnect()` leaves no sharded subscriber connections or listeners.

### Actual Valkey Cluster integration

The Docker test must run six `valkey-server` processes: three primaries and three replicas. Use an explicitly pinned `valkey/valkey` image rather than Redis or `latest`. Running all processes in one container allows the nodes and a host-side test process to use the same announced `127.0.0.1:30000-30005` addresses on Linux, macOS, and CI.

`test/cluster/docker-valkey/main.sh` should:

1. start the container with ports `30000-30005` published;
2. enable cluster mode for all six processes;
3. create the cluster with `valkey-cli --cluster create` and one replica per primary;
4. use a readiness loop based on `CLUSTER INFO`, not a fixed sleep;
5. run `npm run test:js:valkey-cluster`;
6. stop the container through an `EXIT` trap, including on test failure.

The integration suite must use two independent `Cluster` clients and exercise the public API only. It must:

- choose channels owned by at least two different primaries;
- `SSUBSCRIBE` to both channels;
- call `SPUBLISH` from the second client;
- assert receipt of the correct `smessage` values with a bounded timeout;
- unsubscribe and disconnect cleanly so the test cannot pass with leaked handles.

A follow-up integration case should move or fail over one subscribed slot and verify delivery after the slot cache refresh. This recovery case may land separately if the initial PR clearly tracks it.

### GitHub Actions

Add a separate `test-valkey-cluster` job rather than extending the existing Redis-based `test-cluster` job. The job should check out the repository, install the supported Node.js version, run `npm ci`, and invoke `npm run test:integration:valkey-cluster`. Docker logs and `CLUSTER NODES` output should be printed on failure. Keeping this as a distinct required check makes it clear that sharded Pub/Sub was tested against Valkey itself.

## Initial acceptance criteria

- The reproduction in issue #13 receives `smessage` reliably when publisher and subscriber are separate `Cluster` instances.
- Sharded subscription commands never use an unrelated random node.
- Classic Pub/Sub tests remain unchanged and passing.
- The dedicated `test-valkey-cluster` GitHub Actions job passes against the pinned Valkey image.
- The same integration test runs locally through one documented npm command.
- Slot migration and reconnect tests pass without leaked connections or unhandled errors.
