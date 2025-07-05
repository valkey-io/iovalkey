import { expectAssignable, expectType } from "tsd";
import { Valkey, Cluster, NatMap, DNSLookupFunction } from "../../built";

expectType<Valkey>(new Valkey());

// TCP
expectType<Valkey>(new Valkey());
expectType<Valkey>(new Valkey(6379));
expectType<Valkey>(new Valkey({ port: 6379 }));
expectType<Valkey>(new Valkey({ host: "localhost" }));
expectType<Valkey>(new Valkey({ host: "localhost", port: 6379 }));
expectType<Valkey>(new Valkey({ host: "localhost", port: 6379, family: 4 }));
expectType<Valkey>(new Valkey({ host: "localhost", port: 6379, family: 4 }));
expectType<Valkey>(new Valkey(6379, "localhost", { password: "password" }));

// Socket
expectType<Valkey>(new Valkey("/tmp/redis.sock"));
expectType<Valkey>(new Valkey("/tmp/redis.sock", { password: "password" }));

// TLS
expectType<Valkey>(new Valkey({ tls: {} }));
expectType<Valkey>(new Valkey({ tls: { ca: "myca" } }));

// Sentinels
expectType<Valkey>(
  new Valkey({
    sentinels: [{ host: "localhost", port: 16379 }],
    sentinelPassword: "password",
  })
);

// Cluster
expectType<Cluster>(new Cluster([30001, 30002]));
expectType<Cluster>(new Cluster([30001, 30002]));
expectType<Cluster>(new Cluster([30001, "localhost"]));
expectType<Cluster>(new Cluster([30001, "localhost", { port: 30002 }]));
expectType<Cluster>(
  new Cluster([30001, 30002], {
    enableAutoPipelining: true,
  })
);

expectAssignable<NatMap>({
  "10.0.1.230:30001": { host: "203.0.113.73", port: 30001 },
  "10.0.1.231:30001": { host: "203.0.113.73", port: 30002 },
  "10.0.1.232:30001": { host: "203.0.113.73", port: 30003 },
});

expectAssignable<DNSLookupFunction>((address, callback) =>
  callback(null, address)
);
