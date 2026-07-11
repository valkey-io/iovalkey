"use strict";

const assert = require("assert");
const Valkey = require("../../built");

assert.strictEqual(Valkey.Valkey, Valkey);
assert.strictEqual(Valkey.default, Valkey);
assert.strictEqual(Valkey.Redis, Valkey);
