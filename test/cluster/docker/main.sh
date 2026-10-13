#!/bin/bash

set -euo pipefail

IMAGE=grokzen/redis-cluster:latest
NAME=redis-cluster-ioredis-test

# Pull first so the wait below doesn't include the download time
docker pull -q $IMAGE

docker run --rm --name $NAME -e "INITIAL_PORT=30000" -e "IP=0.0.0.0" -p 30000-30005:30000-30005 $IMAGE &
trap 'docker stop $NAME' EXIT

npm install

for i in {1..60}; do
  if docker exec $NAME redis-cli -p 30000 CLUSTER INFO 2>/dev/null | grep -q cluster_state:ok; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Cluster did not become ready in 60s"
    exit 1
  fi
  sleep 1
done

for port in {30000..30005}; do
  docker exec $NAME /bin/bash -c "redis-cli -p $port CONFIG SET protected-mode no"
done

npm run test:js:cluster || npm run test:js:cluster || npm run test:js:cluster
