// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readableShareStatus, type ShareStatus } from "./share";

// Go's nil slice marshals to null, and the panel indexes these three lists
// directly. Reading .length off null throws during render, which unmounts the
// whole window — so the wire boundary has to hand the panel lists.
describe("a share status the panel can index", () => {
  it("reads an absent list as an empty one", () => {
    const wire = { open: false, addresses: null, devices: null, cloudDevices: null } as unknown as ShareStatus;
    const read = readableShareStatus(wire);
    expect(read.addresses).toEqual([]);
    expect(read.devices).toEqual([]);
    expect(read.cloudDevices).toEqual([]);
    expect(read.open).toBe(false);
  });

  it("keeps the lists it was given, and what else the status said", () => {
    const wire: ShareStatus = {
      open: true,
      origin: "http://10.0.0.2:41234",
      addresses: [{ ip: "10.0.0.2", interface: "en0", kind: "lan" }],
      devices: [{ id: "d1", name: "Pixel", pairedAt: "2026-01-01T00:00:00Z", lastSeen: "2026-01-01T00:00:00Z", online: true }],
      cloudDevices: [],
      offerExpires: "2026-01-01T00:05:00Z",
    };
    expect(readableShareStatus(wire)).toEqual(wire);
  });
});
