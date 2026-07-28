#!/usr/bin/env bash

set -euo pipefail

container_name="iovalkey-valkey-cluster-test"
image="${VALKEY_CLUSTER_IMAGE:-valkey/valkey:8.0.9}"

cleanup() {
  status=$?
  if (( status != 0 )); then
    echo "Valkey Cluster integration test failed; collecting diagnostics" >&2
    docker logs "$container_name" >&2 || true
    docker exec "$container_name" valkey-cli -p 30000 CLUSTER NODES >&2 || true
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT

docker rm -f "$container_name" >/dev/null 2>&1 || true

docker run --detach \
  --name "$container_name" \
  --publish 30000-30005:30000-30005 \
  --entrypoint /bin/sh \
  "$image" \
  -c '
    set -eu
    for port in 30000 30001 30002 30003 30004 30005; do
      mkdir -p "/data/$port"
      valkey-server \
        --port "$port" \
        --bind 0.0.0.0 \
        --protected-mode no \
        --cluster-enabled yes \
        --cluster-config-file "nodes.conf" \
        --cluster-node-timeout 5000 \
        --appendonly no \
        --dir "/data/$port" \
        --daemonize yes
    done

    for port in 30000 30001 30002 30003 30004 30005; do
      until valkey-cli -p "$port" PING >/dev/null 2>&1; do sleep 0.1; done
    done
    valkey-cli --cluster create \
      127.0.0.1:30000 127.0.0.1:30001 127.0.0.1:30002 \
      127.0.0.1:30003 127.0.0.1:30004 127.0.0.1:30005 \
      --cluster-replicas 1 --cluster-yes
    tail -f /dev/null
  ' >/dev/null

ready=false
for _ in $(seq 1 300); do
  if docker exec "$container_name" valkey-cli -p 30000 CLUSTER INFO 2>/dev/null \
    | grep -q 'cluster_state:ok'; then
    ready=true
    break
  fi
  sleep 0.1
done

if [[ "$ready" != true ]]; then
  echo "Valkey Cluster did not become ready" >&2
  exit 1
fi

npm run test:js:valkey-cluster
