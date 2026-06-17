/**
 * vrpc — versioning layer for typed RPC.
 */

export { withVersioning } from "./server/withVersioning";
export { createVRPCClient, type VRPCClient } from "./client/createClient";
export type { Pin, PinRouter } from "./types";
