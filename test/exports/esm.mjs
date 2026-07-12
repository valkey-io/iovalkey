import assert from "node:assert";
import Valkey, {
  default as ValkeyDefault,
  Redis,
  Valkey as NamedValkey,
} from "../../built/index.js";

assert.strictEqual(NamedValkey, Valkey);
assert.strictEqual(ValkeyDefault, Valkey);
assert.strictEqual(Redis, Valkey);
