import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInputReport,
  requestBandPacket,
  requestDeviceVolumePacket,
  requestEqPresetPacket,
  requestFirmwareVersionPacket,
  requestInlineControlPacket,
  requestSampleRatePacket,
  requestUacModePacket,
  setBandPacket,
  setDeviceVolumePacket,
  setEqPresetPacket,
  setInlineControlPacket,
  setMasterGainPacket,
  setUacModePacket,
} from "../protocol.js";

test("encodes JA11 state reads from the official command table", () => {
  assert.deepEqual([...requestDeviceVolumePacket()], [0xbb, 0x0b, 0, 0, 2, 0, 0, 0xee]);
  assert.deepEqual([...requestSampleRatePacket()], [0xbb, 0x0b, 0, 0, 9, 0, 0, 0xee]);
  assert.deepEqual([...requestFirmwareVersionPacket()], [0xbb, 0x0b, 0, 0, 11, 0, 0, 0xee]);
  assert.deepEqual([...requestInlineControlPacket()], [0xbb, 0x0b, 0, 0, 18, 0, 0, 0xee]);
  assert.deepEqual([...requestEqPresetPacket()], [0xbb, 0x0b, 0, 0, 22, 0, 0, 0xee]);
  assert.deepEqual([...requestUacModePacket()], [0xbb, 0x0b, 0, 0, 32, 0, 0, 0xee]);
});

test("encodes guarded one-byte device writes", () => {
  assert.deepEqual([...setDeviceVolumePacket(37)], [0xaa, 0x0a, 0, 0, 2, 1, 37, 0, 0xee]);
  assert.deepEqual([...setInlineControlPacket(true)], [0xaa, 0x0a, 0, 0, 18, 1, 1, 0, 0xee]);
  assert.deepEqual([...setEqPresetPacket(3)], [0xaa, 0x0a, 0, 0, 22, 1, 3, 0, 0xee]);
  assert.deepEqual([...setEqPresetPacket(4)], [0xaa, 0x0a, 0, 0, 22, 1, 4, 0, 0xee]);
  assert.deepEqual([...setUacModePacket(1)], [0xaa, 0x0a, 0, 0, 32, 1, 1, 0, 0xee]);
});

test("encodes a PEQ band", () => {
  assert.deepEqual(
    [...setBandPacket(2, { type: "PK", gain: -2.5, freq: 1000, q: 0.7 })],
    [0xaa, 0x0a, 0, 0, 21, 8, 2, 0xff, 0xe7, 0x03, 0xe8, 0, 70, 0, 0, 0xee],
  );
});

test("encodes negative master gain little-endian", () => {
  assert.deepEqual([...setMasterGainPacket(-1)], [0xaa, 0x0a, 0, 0, 23, 2, 0, 0xf6, 0, 0xee]);
});

test("parses band response", () => {
  const response = Uint8Array.from([0xbb, 0x0b, 0, 0, 21, 8, 1, 0xff, 0xe7, 0x03, 0xe8, 0, 70, 0]);
  assert.deepEqual(parseInputReport(response), {
    type: "band", index: 1, value: { gain: -2.5, freq: 1000, q: 0.7, type: "PK" },
  });
});

test("parses JA11 device state responses", () => {
  assert.deepEqual(
    parseInputReport(Uint8Array.from([0xbb, 0x0b, 0, 0, 2, 1, 37, 0, 0xee])),
    { type: "deviceVolume", value: 37 },
  );
  assert.deepEqual(
    parseInputReport(Uint8Array.from([0xbb, 0x0b, 0, 0, 9, 1, 7, 0, 0xee])),
    { type: "sampleRate", code: 7, value: "352.8 kHz" },
  );
  assert.deepEqual(
    parseInputReport(Uint8Array.from([0xbb, 0x0b, 0, 0, 11, 2, 2, 20, 0, 0xee])),
    { type: "firmwareVersion", value: "2.20" },
  );
  assert.deepEqual(
    parseInputReport(Uint8Array.from([0xbb, 0x0b, 0, 0, 18, 1, 1, 0, 0xee])),
    { type: "inlineControl", value: true },
  );
  assert.deepEqual(
    parseInputReport(Uint8Array.from([0xbb, 0x0b, 0, 0, 22, 1, 3, 0, 0xee])),
    { type: "eqPreset", code: 3, value: "User 1" },
  );
  assert.deepEqual(
    parseInputReport(Uint8Array.from([0xbb, 0x0b, 0, 0, 22, 1, 4, 0, 0xee])),
    { type: "eqPreset", code: 4, value: "Off" },
  );
  assert.deepEqual(
    parseInputReport(Uint8Array.from([0xbb, 0x0b, 0, 0, 32, 1, 1, 0, 0xee])),
    { type: "uacMode", code: 1, value: "UAC 2.0" },
  );
});

test("accepts a raw HID report with report ID included", () => {
  assert.deepEqual(
    parseInputReport(Uint8Array.from([2, 0xbb, 0x0b, 0, 0, 18, 1, 0, 0, 0xee])),
    { type: "inlineControl", value: false },
  );
});

test("rejects unsafe one-byte settings", () => {
  assert.throws(() => setDeviceVolumePacket(61), RangeError);
  assert.throws(() => setInlineControlPacket(1), TypeError);
  assert.throws(() => setEqPresetPacket(5), RangeError);
  assert.throws(() => setUacModePacket(-1), RangeError);
});

test("rejects invalid band index", () => {
  assert.throws(() => requestBandPacket(5), RangeError);
});
