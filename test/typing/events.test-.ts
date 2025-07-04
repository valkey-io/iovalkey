import { expectType } from "tsd";
import { Valkey } from "../../built";

const redis = new Valkey();

expectType<Valkey>(redis.on("connect", () => {}));
expectType<Valkey>(redis.on("ready", () => {}));
expectType<Valkey>(redis.on("close", () => {}));
expectType<Valkey>(redis.on("end", () => {}));
expectType<Valkey>(
  redis.on("error", (error) => {
    expectType<Error>(error);
  })
);

expectType<Valkey>(redis.once("connect", () => {}));
expectType<Valkey>(redis.once("ready", () => {}));
expectType<Valkey>(redis.once("close", () => {}));
expectType<Valkey>(redis.once("end", () => {}));
expectType<Valkey>(
  redis.once("error", (error) => {
    expectType<Error>(error);
  })
);

redis.on("message", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

redis.on("messageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

redis.on("pmessage", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<string>(channel);
  expectType<string>(message);
});

redis.on("pmessageBuffer", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

redis.once("message", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

redis.once("messageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

redis.once("pmessage", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<string>(channel);
  expectType<string>(message);
});

redis.once("pmessageBuffer", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});
