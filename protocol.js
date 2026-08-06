// FiiO/JadeAudio JA11 WebHID protocol.
// Based on packet captures documented by fiiocontrol-oss (Unlicense).

export const JA11_FILTER = { vendorId: 0x2972, productId: 0x0102 };
export const REPORT_ID = 2;
export const BAND_COUNT = 5;
export const FILTER_TYPES = Object.freeze({ PK: 0, LSC: 1, HSC: 2 });
export const FILTER_NAMES = Object.freeze(["PK", "LSC", "HSC"]);
export const COMMANDS = Object.freeze({
  DEVICE_VOLUME: 2,
  SAMPLE_RATE: 9,
  FIRMWARE_VERSION: 11,
  INLINE_CONTROL: 18,
  EQ_BAND: 21,
  EQ_PRESET: 22,
  MASTER_GAIN: 23,
  SAVE: 25,
  EQ_RESET: 27,
  UAC_MODE: 32,
});
export const SAMPLE_RATE_NAMES = Object.freeze([
  "32 kHz", "44.1 kHz", "48 kHz", "88.2 kHz", "96 kHz",
  "176.4 kHz", "192 kHz", "352.8 kHz", "384 kHz",
  "705.6 kHz", "768 kHz", "DSD64", "DSD128", "DSD256", "DSD512",
]);
export const EQ_PRESET_NAMES = Object.freeze(["Vocal", "Classic", "Bass", "User 1", "Off"]);
export const UAC_MODE_NAMES = Object.freeze(["UAC 1.0", "UAC 2.0"]);
export const PEQ_LIMITS = Object.freeze({
  masterGain: Object.freeze({ min: -12, max: 12, step: 0.1, decimals: 1 }),
  freq: Object.freeze({ min: 20, max: 20000, step: 1, decimals: 0 }),
  gain: Object.freeze({ min: -12, max: 12, step: 0.1, decimals: 1 }),
  q: Object.freeze({ min: 0.1, max: 10, step: 0.01, decimals: 2 }),
});

function uint16(value) {
  return value < 0 ? 0x10000 + value : value;
}

function requireInteger(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function requirePeqNumber(value, limits, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if (value < limits.min || value > limits.max) {
    throw new RangeError(`${name} must be from ${limits.min} to ${limits.max}`);
  }

  const scale = 10 ** limits.decimals;
  const scaled = value * scale;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-7) {
    throw new RangeError(`${name} must use increments of ${limits.step}`);
  }
  const normalized = Math.round(scaled) / scale;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function validatePeqBand(band, index) {
  const name = Number.isInteger(index) ? `Band ${index + 1}` : "Band";
  if (!band || typeof band !== "object" || Array.isArray(band)) {
    throw new TypeError(`${name} must be an object`);
  }
  if (FILTER_TYPES[band.type] === undefined) {
    throw new TypeError(`${name} has an unknown filter type: ${String(band.type)}`);
  }
  return {
    type: band.type,
    gain: requirePeqNumber(band.gain, PEQ_LIMITS.gain, `${name} gain`),
    freq: requirePeqNumber(band.freq, PEQ_LIMITS.freq, `${name} frequency`),
    q: requirePeqNumber(band.q, PEQ_LIMITS.q, `${name} Q`),
  };
}

export function validatePeqSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Configuration must be an object");
  }
  if (!Array.isArray(snapshot.bands) || snapshot.bands.length !== BAND_COUNT) {
    throw new RangeError(`Configuration must contain exactly ${BAND_COUNT} bands`);
  }
  return {
    masterGain: requirePeqNumber(snapshot.masterGain, PEQ_LIMITS.masterGain, "Preamp gain"),
    bands: snapshot.bands.map((band, index) => validatePeqBand(band, index)),
  };
}

export function requestValuePacket(command) {
  const value = requireInteger(command, 0, 0xff, "Command");
  return Uint8Array.from([0xbb, 0x0b, 0, 0, value, 0, 0, 0xee]);
}

export function setByteValuePacket(command, value) {
  const commandByte = requireInteger(command, 0, 0xff, "Command");
  const valueByte = requireInteger(value, 0, 0xff, "Value");
  return Uint8Array.from([0xaa, 0x0a, 0, 0, commandByte, 1, valueByte, 0, 0xee]);
}

export function requestMasterGainPacket() {
  return requestValuePacket(COMMANDS.MASTER_GAIN);
}

export function requestBandPacket(index) {
  if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) {
    throw new RangeError(`Band index must be 0-${BAND_COUNT - 1}`);
  }
  return Uint8Array.from([0xbb, 0x0b, 0, 0, COMMANDS.EQ_BAND, 1, index, 0xee]);
}

export const requestDeviceVolumePacket = () => requestValuePacket(COMMANDS.DEVICE_VOLUME);
export const requestSampleRatePacket = () => requestValuePacket(COMMANDS.SAMPLE_RATE);
export const requestFirmwareVersionPacket = () => requestValuePacket(COMMANDS.FIRMWARE_VERSION);
export const requestInlineControlPacket = () => requestValuePacket(COMMANDS.INLINE_CONTROL);
export const requestEqPresetPacket = () => requestValuePacket(COMMANDS.EQ_PRESET);
export const requestUacModePacket = () => requestValuePacket(COMMANDS.UAC_MODE);

export function setDeviceVolumePacket(volume) {
  return setByteValuePacket(
    COMMANDS.DEVICE_VOLUME,
    requireInteger(volume, 0, 60, "Device volume"),
  );
}

export function setInlineControlPacket(enabled) {
  if (typeof enabled !== "boolean") throw new TypeError("Inline control state must be boolean");
  return setByteValuePacket(COMMANDS.INLINE_CONTROL, enabled ? 1 : 0);
}

export function setEqPresetPacket(preset) {
  return setByteValuePacket(COMMANDS.EQ_PRESET, requireInteger(preset, 0, 4, "EQ preset"));
}

export function setUacModePacket(mode) {
  return setByteValuePacket(COMMANDS.UAC_MODE, requireInteger(mode, 0, 1, "UAC mode"));
}

export function setMasterGainPacket(gainDb) {
  const gain = requirePeqNumber(gainDb, PEQ_LIMITS.masterGain, "Preamp gain");
  const value = uint16(Math.round(gain * 2560));
  return Uint8Array.from([
    0xaa, 0x0a, 0, 0, COMMANDS.MASTER_GAIN, 2,
    value & 0xff, (value >> 8) & 0xff,
    0, 0xee,
  ]);
}

export function setBandPacket(index, band) {
  if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) {
    throw new RangeError(`Band index must be 0-${BAND_COUNT - 1}`);
  }

  const valid = validatePeqBand(band, index);
  const gain = uint16(Math.round(valid.gain * 10));
  const frequency = valid.freq;
  const q = Math.round(valid.q * 100);
  const filterType = FILTER_TYPES[valid.type];

  return Uint8Array.from([
    0xaa, 0x0a, 0, 0, COMMANDS.EQ_BAND, 8, index,
    (gain >> 8) & 0xff, gain & 0xff,
    (frequency >> 8) & 0xff, frequency & 0xff,
    (q >> 8) & 0xff, q & 0xff,
    filterType, 0, 0xee,
  ]);
}

export function savePacket() {
  return Uint8Array.from([0xaa, 0x0a, 0, 0, COMMANDS.SAVE, 1, 3, 0, 0xee]);
}

export function parseInputReport(input) {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input);
  const data = raw[0] === REPORT_ID && (raw[1] === 0xbb || raw[1] === 0xaa)
    ? raw.subarray(1)
    : raw;
  const command = data[4];

  if (data.length < 7) return null;

  if (command === COMMANDS.DEVICE_VOLUME) {
    return { type: "deviceVolume", value: data[6] };
  }

  if (command === COMMANDS.SAMPLE_RATE) {
    const code = data[6];
    return { type: "sampleRate", code, value: SAMPLE_RATE_NAMES[code] ?? `Code ${code}` };
  }

  if (command === COMMANDS.FIRMWARE_VERSION && data.length >= 8) {
    return { type: "firmwareVersion", value: `${data[6]}.${data[7]}` };
  }

  if (command === COMMANDS.INLINE_CONTROL) {
    return { type: "inlineControl", value: data[6] === 1 };
  }

  if (command === COMMANDS.EQ_PRESET) {
    const code = data[6];
    return { type: "eqPreset", code, value: EQ_PRESET_NAMES[code] ?? `Preset ${code}` };
  }

  if (command === COMMANDS.UAC_MODE) {
    const code = data[6];
    return { type: "uacMode", code, value: UAC_MODE_NAMES[code] ?? `Mode ${code}` };
  }

  if (command === COMMANDS.MASTER_GAIN && data.length >= 8) {
    const raw = (data[7] << 8) | data[6];
    const signed = raw > 0x7fff ? raw - 0x10000 : raw;
    return { type: "masterGain", value: Number((signed / 2560).toFixed(1)) };
  }

  if (command === COMMANDS.EQ_BAND && data.length >= 14) {
    const rawGain = (data[7] << 8) | data[8];
    const signedGain = rawGain > 0x7fff ? rawGain - 0x10000 : rawGain;
    return {
      type: "band",
      index: data[6],
      value: {
        gain: Number((signedGain / 10).toFixed(1)),
        freq: (data[9] << 8) | data[10],
        q: Number((((data[11] << 8) | data[12]) / 100).toFixed(2)),
        type: FILTER_NAMES[data[13]] ?? "PK",
      },
    };
  }

  return null;
}
