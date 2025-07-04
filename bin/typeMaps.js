module.exports = {
  key: "ValkeyKey",
  string: (name) =>
    [
      "value",
      "member",
      "element",
      "arg",
      "id",
      "pivot",
      "threshold",
      "start",
      "end",
      "max",
      "min",
    ].some((pattern) => name.toLowerCase().includes(pattern))
      ? "string | Buffer | number"
      : "string | Buffer",
  pattern: "string",
  number: () => "number | string",
};
