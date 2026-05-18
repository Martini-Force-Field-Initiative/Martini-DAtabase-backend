import Router from "socket-controller-rdy";
import { MembraneBuilder } from "./membraneBuilder";

const ApiSocket = new Router();
import { Martinize } from "./martinize";
import { PolymerGenerator } from "./polymerGenerator";
import { History } from "./history";
import { ComputationApi } from "./computationApi";

ApiSocket.use(MembraneBuilder);
ApiSocket.use(PolymerGenerator);
ApiSocket.use(Martinize);
ApiSocket.use(History);
ApiSocket.use(ComputationApi);

export default ApiSocket;
