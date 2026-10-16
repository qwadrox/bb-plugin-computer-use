import snapshotJson from "./driver-snapshot.json";
import { normalizeDriverTools, type DriverCatalog } from "./driver-tools.js";

// Typed loosely on purpose: the generated file is large, and its shape is
// checked by normalizeDriverTools rather than by the compiler.
const raw = snapshotJson as unknown as { driverVersion: string; tools: unknown[] };

/** The Cua Driver version this plugin release was tested against (`npm run sync:tools`). */
export const TESTED_DRIVER_VERSION: string = raw.driverVersion;

/** The tested driver's catalog, used for a machine whose own driver has not been read yet. */
export const SNAPSHOT_CATALOG: DriverCatalog = {
  driverVersion: raw.driverVersion,
  tools: normalizeDriverTools(raw.tools),
};
