/** The parts of sync-driver-tools.mjs that tests compare with src/. */
export declare const PROTOCOL_VERSION: string;
export declare function releaseTag(version: string): string;
export declare function installerSources(version: string): Array<{ name: string; url: string; released: boolean }>;
