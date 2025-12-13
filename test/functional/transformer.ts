import Valkey from "../../lib/Valkey.js";
import { expect } from "chai";

describe("transformer", () => {
  describe("default transformer", () => {
    describe("hmset", () => {
      it("should support object", async () => {
        const valkey = new Valkey();
        expect(await valkey.hmset("foo", { a: 1, b: "2" })).to.eql("OK");
        expect(await valkey.hget("foo", "b")).to.eql("2");
      });

      it("should support Map with string keys", async () => {
        const valkey = new Valkey();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "2");
        map.set(42, true);
        map.set(Buffer.from("buffer"), "utf8");
        map.set(Buffer.from([0xff]), "binary");
        expect(await valkey.hmset("foo", map)).to.eql("OK");
        expect(await valkey.hget("foo", "a")).to.eql("1");
        expect(await valkey.hget("foo", "b")).to.eql("2");
        expect(await valkey.hget("foo", "42")).to.eql("true");
        expect(await valkey.hget("foo", "buffer")).to.eql("utf8");
        expect(await valkey.hget("foo", Buffer.from([0xff]))).to.eql("binary");
      });

      it("should not affect the old way", async () => {
        const valkey = new Valkey();
        expect(await valkey.hmset("foo", "a", 1, "b", "2")).to.eql("OK");
        expect(await valkey.hget("foo", "b")).to.eql("2");
      });
    });

    describe("mset", () => {
      it("should support object", async () => {
        const valkey = new Valkey();
        expect(await valkey.mset({ a: 1, b: "2" })).to.eql("OK");
        expect(await valkey.mget("a", "b")).to.eql(["1", "2"]);
      });

      it("should support Map", async () => {
        const valkey = new Valkey();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "2");
        expect(await valkey.mset(map)).to.eql("OK");
        expect(await valkey.mget("a", "b")).to.eql(["1", "2"]);
      });

      it("should not affect the old way", async () => {
        const valkey = new Valkey();
        expect(await valkey.mset("a", 1, "b", "2")).to.eql("OK");
        expect(await valkey.mget("a", "b")).to.eql(["1", "2"]);
      });

      it("should work with keyPrefix option", async () => {
        const valkey = new Valkey({ keyPrefix: "foo:" });
        expect(await valkey.mset({ a: 1, b: "2" })).to.eql("OK");

        const otherValkey = new Valkey();
        expect(await otherValkey.mget("foo:a", "foo:b")).to.eql(["1", "2"]);
      });
    });

    describe("msetnx", () => {
      it("should support object", (done) => {
        const valkey = new Valkey();
        valkey.msetnx({ a: 1, b: "2" }, function (err, result) {
          expect(result).to.eql(1);
          valkey.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should support Map", (done) => {
        const valkey = new Valkey();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "2");
        valkey.msetnx(map, function (err, result) {
          expect(result).to.eql(1);
          valkey.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should not affect the old way", (done) => {
        const valkey = new Valkey();
        valkey.msetnx("a", 1, "b", "2", function (err, result) {
          expect(result).to.eql(1);
          valkey.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should work with keyPrefix option", (done) => {
        const valkey = new Valkey({ keyPrefix: "foo:" });
        valkey.msetnx({ a: 1, b: "2" }, function (err, result) {
          expect(result).to.eql(1);
          const otherValkey = new Valkey();
          otherValkey.mget("foo:a", "foo:b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
    });

    describe("hgetall", () => {
      it("should return an object", (done) => {
        const valkey = new Valkey();
        valkey.hmset("foo", "k1", "v1", "k2", "v2", () => {
          valkey.hgetall("foo", function (err, result) {
            expect(result).to.eql({ k1: "v1", k2: "v2" });
            done();
          });
        });
      });

      it("should return {} when key not exists", (done) => {
        const valkey = new Valkey();
        valkey.hgetall("foo", function (err, result) {
          expect(result).to.eql({});
          done();
        });
      });
    });

    describe("hset", () => {
      it("should support object", async () => {
        const valkey = new Valkey();
        // NOTE: could simplify these tests using await valkey.hset instead,
        // but not sure if this is deliberately testing the transformers with callbacks
        return new Promise((resolve, reject) => {
          valkey.hset("foo", { a: 1, b: "e", c: 123 }, function (err, result) {
            if (err) {
              return reject(err);
            }
            expect(result).to.eql(3);
            valkey.hget("foo", "b", function (err, result) {
              expect(result).to.eql("e");
              resolve();
            });
          });
        });
      });
      it("should support Map", async () => {
        const valkey = new Valkey();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "e");
        return new Promise((resolve, reject) => {
          valkey.hset("foo", map, function (err, result) {
            if (err) {
              return reject(err);
            }
            expect(result).to.eql(2);
            valkey.hget("foo", "b", function (err, result) {
              if (err) {
                return reject(err);
              }
              expect(result).to.eql("e");
              resolve();
            });
          });
        });
      });
      it("should affect the old way", async () => {
        const valkey = new Valkey();
        return new Promise((resolve) => {
          valkey.hset("foo", "a", 1, "b", "e", function (err, result) {
            expect(result).to.eql(2);
            valkey.hget("foo", "b", function (err, result) {
              expect(result).to.eql("e");
              resolve();
            });
          });
        });
      });
    });
  });
  describe("custom transformer", () => {
    describe("rewriting command names in argument transformer", () => {
      it("simple commands", async () => {
        try {
          const valkey = new Valkey();
          Valkey.Command.setArgumentTransformer("customNonStandardRedisCommand", args => {
            return ["set", ...args.slice(1)];
          }, true);
          Valkey.Command.setReplyTransformer("customNonStandardRedisCommand", reply => {
            return reply + reply;
          });
          valkey.addBuiltinCommand("customNonStandardRedisCommand");  
          // @ts-expect-error
          expect(await valkey.customNonStandardRedisCommand('foo', 'bar')).to.eql("OKOK");
          expect(await valkey.get('foo')).to.eql('bar');
        } finally {
          Valkey.Command.setArgumentTransformer('customNonStandardRedisCommand');
        }
      });
      it("pipelined multi/exec commands", async() => {
        try {
          const valkey = new Valkey();
          Valkey.Command.setArgumentTransformer("customNonStandardRedisCommand", args => {
            return ["set", ...args.slice(1)];
          }, true);
          Valkey.Command.setReplyTransformer("customNonStandardRedisCommand", reply => {
            return reply + reply;
          });
          valkey.addBuiltinCommand("customNonStandardRedisCommand");
          const multi = valkey.multi();
          // @ts-expect-error
          multi.customNonStandardRedisCommand('foo', 'bar');
          multi.get('foo');
          const results = await multi.exec();
          expect(results).to.eql([[null, "OKOK"], [null, "bar"]]);
        } finally {
          Valkey.Command.setArgumentTransformer('customNonStandardRedisCommand');
        }
      })
    });
  });
});
