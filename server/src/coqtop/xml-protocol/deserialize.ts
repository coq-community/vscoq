import { Deserialize_8_7 } from "./deserialize.8.7";

const DEFAULT_DESERIALIZER = Deserialize_8_7;

export function createDeserializer(version: string) {
  return new DEFAULT_DESERIALIZER();
}
