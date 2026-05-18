import { Readable } from "stream";

import {
  AvailableForceField,
  BASE_DEFAULT_FORCEFIELD,
} from "../Stores/ForceFieldStore";

export const topologyConsumers = ["martinize", "polyply", "insane"];
export type TopologyConsumer = (typeof topologyConsumers)[number];

export interface TopologyMakerParams {
  consumer: TopologyConsumer;
  srcTopology?: string | Readable;
  forcefield: AvailableForceField;
  itpsPath?: string[];
  excludedItps?: string[];
  excludedItpsExtra?: string[];
  linkTargetDir?: string;
  excludedDefine?: string[];
  excludedItpsExtraByRegExp?: string[];
}

export const isConsumer = (value: any): value is TopologyConsumer => {
  return topologyConsumers.includes(value);
};
