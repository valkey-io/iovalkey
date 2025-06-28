import AbstractConnector from "./AbstractConnector.js";

interface ConnectorConstructor {
  new (options: unknown): AbstractConnector;
}

export default ConnectorConstructor;
