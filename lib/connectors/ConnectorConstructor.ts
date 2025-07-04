import { AbstractConnector } from "./AbstractConnector.js";

interface ConnectorConstructor {
  new (options: unknown): AbstractConnector;
}

export { ConnectorConstructor };
export default ConnectorConstructor;
