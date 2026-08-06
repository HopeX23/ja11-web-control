import {
  BAND_COUNT,
  EQ_PRESET_NAMES,
  JA11_FILTER,
  PEQ_LIMITS,
  REPORT_ID,
  parseInputReport,
  requestBandPacket,
  requestDeviceVolumePacket,
  requestEqPresetPacket,
  requestFirmwareVersionPacket,
  requestInlineControlPacket,
  requestMasterGainPacket,
  requestSampleRatePacket,
  requestUacModePacket,
  savePacket,
  setBandPacket,
  setDeviceVolumePacket,
  setEqPresetPacket,
  setInlineControlPacket,
  setMasterGainPacket,
  setUacModePacket,
  validatePeqSnapshot,
} from "./protocol.js";

const DEFAULT_BANDS = [
  { type: "PK", gain: 0, freq: 100, q: 0.7 },
  { type: "PK", gain: 0, freq: 500, q: 0.7 },
  { type: "PK", gain: 0, freq: 1000, q: 0.7 },
  { type: "PK", gain: 0, freq: 2500, q: 0.7 },
  { type: "PK", gain: 0, freq: 10000, q: 0.7 },
];
const BAND_COLORS = ["#d6442e", "#b36b00", "#39724f", "#286d91", "#6c5791"];
const NS = "http://www.w3.org/2000/svg";
const PLOT = { left: 56, right: 18, top: 18, bottom: 42, width: 826, height: 320 };
const DEVICE_COMMAND_INTERVAL = 200;
const EMPTY_HARDWARE_STATE = Object.freeze({
  deviceVolume: null,
  sampleRate: null,
  firmwareVersion: null,
  inlineControl: null,
  eqPreset: null,
  uacMode: null,
});

let device;
let pendingResponse;
let state = { masterGain: 0, bands: structuredClone(DEFAULT_BANDS) };
let originalState = structuredClone(state);
let hardwareState = { ...EMPTY_HARDWARE_STATE };
let volumeDraft = null;
let uacDraft = null;
let presetDraft = null;
let armedVolume = null;
let expectedRestart = null;
let history = [];
let future = [];
let editStart;
let activeInputKey;
let dragStart;
let dragIndex;
let comparingOriginal = false;

const $ = (selector) => document.querySelector(selector);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => structuredClone(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const BAND_FIELD_LABELS = Object.freeze({ freq: "frequency", gain: "gain", q: "Q" });

function quantizePeqNumber(value, limits) {
  const scale = 10 ** limits.decimals;
  const bounded = clamp(value, limits.min, limits.max);
  const quantized = Math.round(bounded * scale) / scale;
  return Object.is(quantized, -0) ? 0 : clamp(quantized, limits.min, limits.max);
}

function formatPeqNumber(value, limits) {
  return Number(value).toFixed(limits.decimals);
}

function hasValidPeqNumber(input) {
  return input.value !== "" && Number.isFinite(input.valueAsNumber) && input.validity.valid;
}

function markInputValidity(input, valid) {
  if (valid) input.removeAttribute("aria-invalid");
  else input.setAttribute("aria-invalid", "true");
}

function normalizePeqInput(input, previousValue, limits) {
  const raw = input.valueAsNumber;
  if (input.value === "" || !Number.isFinite(raw)) {
    input.value = formatPeqNumber(previousValue, limits);
    markInputValidity(input, true);
    return { value: previousValue, restored: true, adjusted: false };
  }

  const value = quantizePeqNumber(raw, limits);
  input.value = formatPeqNumber(value, limits);
  markInputValidity(input, true);
  return { value, restored: false, adjusted: Math.abs(value - raw) > 1e-9 };
}

function hasInvalidPeqInputs() {
  return [...document.querySelectorAll('#masterGain, #bands input[type="number"]')]
    .some((input) => !hasValidPeqNumber(input));
}

function updateThemeControl() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#themeToggle").textContent = dark ? "Day mode" : "Night mode";
  $("#themeToggle").setAttribute("aria-pressed", String(dark));
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("ja11-theme", next);
  updateThemeControl();
}

function canonical(value) {
  return JSON.stringify({
    masterGain: Number(value.masterGain),
    bands: value.bands.map((band) => ({
      type: band.type,
      freq: Number(band.freq),
      gain: Number(band.gain),
      q: Number(band.q),
    })),
  });
}

function isDirty() {
  return canonical(state) !== canonical(originalState);
}

function setStatus(message, kind = "") {
  $("#status").textContent = message;
  $("#status").dataset.kind = kind;
}

function updateHistoryControls() {
  $("#undo").disabled = history.length === 0;
  $("#redo").disabled = future.length === 0;
}

function updateChangeState() {
  const dirty = isDirty();
  const invalid = hasInvalidPeqInputs();
  $("#changeState").textContent = invalid
    ? "Invalid parameter input"
    : dirty ? "Unsaved User 1 parameters" : "User 1 and draft aligned";
  $("#changeState").dataset.dirty = String(dirty);
  $("#changeState").dataset.invalid = String(invalid);
  const commit = $(".commit-state");
  commit.dataset.dirty = String(dirty);
  commit.dataset.invalid = String(invalid);
  if (invalid) {
    $("#commitTitle").textContent = "Correct the highlighted value";
    $("#commitDetail").textContent = "Apply and Save remain locked until every parameter is valid.";
  } else {
    $("#commitTitle").textContent = dirty ? "Changes not saved to JA11" : "No unsaved changes";
    $("#commitDetail").textContent = dirty
      ? "Apply for listening, then save when confirmed."
      : device?.opened ? "The draft matches the last User 1 read." : "Connect and read the JA11 before editing.";
  }
  const canSendPeq = Boolean(device?.opened) && !expectedRestart && !invalid;
  $("#preview").disabled = !canSendPeq;
  $("#save").disabled = !canSendPeq;
  updateHistoryControls();
}

function renderHardwareState() {
  const connected = Boolean(device?.opened) && !expectedRestart;
  const hasVolume = Number.isInteger(hardwareState.deviceVolume);
  const shownVolume = Number.isInteger(volumeDraft) ? volumeDraft : hardwareState.deviceVolume;
  const hasInlineControl = typeof hardwareState.inlineControl === "boolean";
  const hasUacMode = Number.isInteger(hardwareState.uacMode);
  const hasPreset = Number.isInteger(hardwareState.eqPreset);

  $("#sampleRate").textContent = hardwareState.sampleRate ?? "—";
  $("#firmwareVersion").textContent = hardwareState.firmwareVersion ?? "—";

  $("#deviceVolumeValue").textContent = Number.isInteger(shownVolume) ? `${shownVolume} / 60` : "— / 60";
  if (Number.isInteger(shownVolume)) {
    $("#deviceVolume").value = shownVolume;
    $("#deviceVolumeNumber").value = shownVolume;
  }
  $("#deviceVolume").disabled = !connected || !hasVolume;
  $("#deviceVolumeNumber").disabled = !connected || !hasVolume;
  const volumeChanged = hasVolume && Number.isInteger(shownVolume) && shownVolume !== hardwareState.deviceVolume;
  $("#applyVolume").disabled = !connected || !volumeChanged;
  $("#applyVolume").textContent = Number.isInteger(armedVolume) && armedVolume === shownVolume
    ? `Confirm ${hardwareState.deviceVolume} → ${shownVolume}`
    : volumeChanged ? `Set ${hardwareState.deviceVolume} → ${shownVolume}` : "Set output volume";

  $("#inlineControl").checked = hasInlineControl && hardwareState.inlineControl;
  $("#inlineControl").disabled = !connected || !hasInlineControl;
  $("#inlineControlValue").textContent = hasInlineControl ? (hardwareState.inlineControl ? "On" : "Off") : "—";

  const uacMode = uacDraft ?? hardwareState.uacMode;
  if (hasUacMode) $("#uacMode").value = String(uacMode);
  $("#uacMode").disabled = !connected || !hasUacMode;
  $("#applyUac").disabled = !connected || !hasUacMode || uacMode === hardwareState.uacMode;

  const preset = presetDraft ?? hardwareState.eqPreset;
  if (hasPreset) $("#eqPreset").value = String(preset);
  $("#eqPreset").disabled = !connected || !hasPreset;
  $("#applyPreset").disabled = !connected || !hasPreset || preset === hardwareState.eqPreset;
  $("#activePreset").textContent = hasPreset ? EQ_PRESET_NAMES[hardwareState.eqPreset] : "—";
  $("#activePreset").dataset.custom = String(hardwareState.eqPreset === 3);
}

function showRestartingState() {
  for (const button of document.querySelectorAll("[data-needs-device]")) button.disabled = true;
  $("#connectionBadge").dataset.state = "restarting";
  $("#connectionText").textContent = "Restarting";
  renderHardwareState();
}

function setConnected(connected) {
  for (const button of document.querySelectorAll("[data-needs-device]")) button.disabled = !connected;
  $("#connect").textContent = connected ? "Reconnect" : "Connect JA11";
  $("#connectionBadge").dataset.state = connected ? "connected" : "offline";
  $("#connectionText").textContent = connected ? "Connected" : "Offline";
  renderHardwareState();
  updateChangeState();
}

function bandRow(band, index) {
  const typeLabels = { PK: "Peak", LSC: "Low shelf", HSC: "High shelf" };
  return `
    <tr data-index="${index}" style="--band-color:${BAND_COLORS[index]}">
      <th scope="row"><span class="band-id"><i class="band-swatch"></i>${String(index + 1).padStart(2, "0")}</span></th>
      <td><select data-key="type" aria-label="Band ${index + 1} filter type">
        ${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}" ${band.type === value ? "selected" : ""}>${label}</option>`).join("")}
      </select></td>
      <td><div class="field-with-unit"><input data-key="freq" aria-label="Band ${index + 1} frequency" type="number" min="20" max="20000" step="1" value="${formatPeqNumber(band.freq, PEQ_LIMITS.freq)}" required><span class="unit">Hz</span></div></td>
      <td><div class="field-with-unit"><input data-key="gain" aria-label="Band ${index + 1} gain" type="number" min="-12" max="12" step="0.1" value="${formatPeqNumber(band.gain, PEQ_LIMITS.gain)}" required><span class="unit">dB</span></div></td>
      <td><input data-key="q" aria-label="Band ${index + 1} Q" type="number" min="0.1" max="10" step="0.01" value="${formatPeqNumber(band.q, PEQ_LIMITS.q)}" required></td>
    </tr>`;
}

function renderBands() {
  $("#bands").innerHTML = state.bands.map(bandRow).join("");
}

function renderState({ table = true } = {}) {
  $("#masterGain").value = formatPeqNumber(state.masterGain, PEQ_LIMITS.masterGain);
  markInputValidity($("#masterGain"), true);
  $("#masterGainRange").value = state.masterGain;
  if (table) renderBands();
  drawResponse();
  updateChangeState();
}

function checkpoint(previous = editStart) {
  if (previous && canonical(previous) !== canonical(state)) {
    history.push(clone(previous));
    if (history.length > 50) history.shift();
    future = [];
  }
  editStart = undefined;
  updateHistoryControls();
}

function beginInputHistory(key) {
  if (activeInputKey === key) return;
  history.push(clone(state));
  if (history.length > 50) history.shift();
  future = [];
  activeInputKey = key;
  updateHistoryControls();
}

function xForFrequency(frequency) {
  return PLOT.left + (Math.log10(clamp(frequency, 20, 20000) / 20) / 3) * PLOT.width;
}

function frequencyForX(x) {
  return 20 * (10 ** (((clamp(x, PLOT.left, PLOT.left + PLOT.width) - PLOT.left) / PLOT.width) * 3));
}

function yForGain(gain) {
  return PLOT.top + ((12 - clamp(gain, -12, 12)) / 24) * PLOT.height;
}

function gainForY(y) {
  return 12 - ((clamp(y, PLOT.top, PLOT.top + PLOT.height) - PLOT.top) / PLOT.height) * 24;
}

function makeSvg(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function renderPlotGrid() {
  const grid = $("#plotGrid");
  grid.replaceChildren();
  const frequencyTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const gainTicks = [-12, -6, 0, 6, 12];

  for (const frequency of frequencyTicks) {
    const x = xForFrequency(frequency);
    grid.append(makeSvg("line", { x1: x, y1: PLOT.top, x2: x, y2: PLOT.top + PLOT.height, class: `grid-line ${[20,100,1000,10000,20000].includes(frequency) ? "major" : ""}` }));
    const label = makeSvg("text", { x, y: 363, class: "axis-label", "text-anchor": frequency === 20 ? "start" : frequency === 20000 ? "end" : "middle" });
    label.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
    grid.append(label);
  }

  for (const gain of gainTicks) {
    const y = yForGain(gain);
    grid.append(makeSvg("line", { x1: PLOT.left, y1: y, x2: PLOT.left + PLOT.width, y2: y, class: gain === 0 ? "zero-line" : "grid-line major" }));
    const label = makeSvg("text", { x: 45, y: y + 4, class: "axis-label", "text-anchor": "end" });
    label.textContent = gain > 0 ? `+${gain}` : String(gain);
    grid.append(label);
  }
}

function coefficients(band, sampleRate = 48000) {
  const gain = Number(band.gain);
  const frequency = clamp(Number(band.freq), 20, sampleRate * 0.49);
  const q = clamp(Number(band.q), 0.1, 10);
  const A = 10 ** (gain / 40);
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);

  if (band.type === "PK") {
    return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A };
  }

  const beta = 2 * Math.sqrt(A) * alpha;
  if (band.type === "LSC") {
    return {
      b0: A * ((A + 1) - (A - 1) * cos + beta),
      b1: 2 * A * ((A - 1) - (A + 1) * cos),
      b2: A * ((A + 1) - (A - 1) * cos - beta),
      a0: (A + 1) + (A - 1) * cos + beta,
      a1: -2 * ((A - 1) + (A + 1) * cos),
      a2: (A + 1) + (A - 1) * cos - beta,
    };
  }
  return {
    b0: A * ((A + 1) + (A - 1) * cos + beta),
    b1: -2 * A * ((A - 1) + (A + 1) * cos),
    b2: A * ((A + 1) + (A - 1) * cos - beta),
    a0: (A + 1) - (A - 1) * cos + beta,
    a1: 2 * ((A - 1) - (A + 1) * cos),
    a2: (A + 1) - (A - 1) * cos - beta,
  };
}

function filterGainAt(band, frequency, sampleRate = 48000) {
  if (Number(band.gain) === 0) return 0;
  const c = coefficients(band, sampleRate);
  const w = (2 * Math.PI * frequency) / sampleRate;
  const cos1 = Math.cos(w), sin1 = Math.sin(w), cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -c.b1 * sin1 - c.b2 * sin2;
  const dr = c.a0 + c.a1 * cos1 + c.a2 * cos2;
  const di = -c.a1 * sin1 - c.a2 * sin2;
  return 10 * Math.log10((nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di));
}

function responseAt(frequency) {
  return Number(state.masterGain) + state.bands.reduce((sum, band) => sum + filterGainAt(band, frequency), 0);
}

function drawResponse() {
  const points = [];
  for (let index = 0; index <= 220; index += 1) {
    const frequency = 20 * (10 ** ((index / 220) * 3));
    points.push([xForFrequency(frequency), yForGain(responseAt(frequency))]);
  }
  $("#responsePath").setAttribute("d", points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" "));

  const handles = $("#plotHandles");
  handles.replaceChildren();
  state.bands.forEach((band, index) => {
    const x = xForFrequency(band.freq);
    const y = yForGain(Number(band.gain) + Number(state.masterGain));
    handles.append(makeSvg("line", { x1: x, y1: y, x2: x, y2: yForGain(0), class: "handle-stem" }));
    const circle = makeSvg("circle", {
      cx: x, cy: y, r: 11, fill: BAND_COLORS[index], class: "band-handle",
      tabindex: "0", role: "slider", "data-index": index,
      "aria-label": `Band ${index + 1}: ${Math.round(band.freq)} hertz, ${Number(band.gain).toFixed(1)} decibels`,
      "aria-valuemin": "-12", "aria-valuemax": "12", "aria-valuenow": band.gain,
    });
    handles.append(circle);
    const label = makeSvg("text", { x, y: y + 3.5, class: "handle-label" });
    label.textContent = index + 1;
    handles.append(label);
  });
}

function updateBandInputs(index) {
  const row = $(`#bands tr[data-index="${index}"]`);
  if (!row) return;
  const frequency = row.querySelector('[data-key="freq"]');
  const gain = row.querySelector('[data-key="gain"]');
  frequency.value = formatPeqNumber(state.bands[index].freq, PEQ_LIMITS.freq);
  gain.value = formatPeqNumber(state.bands[index].gain, PEQ_LIMITS.gain);
  markInputValidity(frequency, true);
  markInputValidity(gain, true);
}

function onInputReport(event) {
  const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
  const includesReportId = bytes[0] === REPORT_ID && (bytes[1] === 0xbb || bytes[1] === 0xaa);
  const command = bytes[includesReportId ? 5 : 4];
  const message = parseInputReport(bytes);

  if (pendingResponse?.command === command) pendingResponse.resolve(true);
  if (!message) return;

  let eqChanged = false;
  if (message.type === "masterGain") {
    state.masterGain = message.value;
    eqChanged = true;
  } else if (message.type === "band" && message.index < BAND_COUNT) {
    state.bands[message.index] = message.value;
    eqChanged = true;
  } else if (message.type === "deviceVolume") {
    hardwareState.deviceVolume = message.value;
    volumeDraft = message.value;
    armedVolume = null;
  } else if (message.type === "sampleRate") {
    hardwareState.sampleRate = message.value;
  } else if (message.type === "firmwareVersion") {
    hardwareState.firmwareVersion = message.value;
  } else if (message.type === "inlineControl") {
    hardwareState.inlineControl = message.value;
  } else if (message.type === "eqPreset") {
    hardwareState.eqPreset = message.code;
    presetDraft = message.code;
  } else if (message.type === "uacMode") {
    hardwareState.uacMode = message.code;
    uacDraft = message.code;
  }

  if (eqChanged) renderState();
  else renderHardwareState();
}

async function connect() {
  if (!("hid" in navigator)) throw new Error("This browser does not expose WebHID. Use Chrome, Edge, or Opera.");
  const authorized = await navigator.hid.getDevices();
  let selected = authorized.find((item) => item.vendorId === JA11_FILTER.vendorId && item.productId === JA11_FILTER.productId);
  if (!selected) [selected] = await navigator.hid.requestDevice({ filters: [JA11_FILTER] });
  if (!selected) return;

  if (device?.opened) {
    device.removeEventListener("inputreport", onInputReport);
    await device.close();
  }
  device = selected;
  await device.open();
  device.addEventListener("inputreport", onInputReport);
  expectedRestart = null;
  setConnected(true);
  setStatus(`Connected to ${device.productName || "JA11"}`, "ok");
  await readDevice();
}

async function sendAndWait(packet, timeoutMs = 650) {
  const started = performance.now();
  const token = { command: packet[4], resolve: null };
  const response = new Promise((resolve) => { token.resolve = resolve; });
  pendingResponse = token;
  await device.sendReport(REPORT_ID, packet);
  const matched = await Promise.race([response, sleep(timeoutMs).then(() => false)]);
  if (pendingResponse === token) pendingResponse = undefined;
  const remainingInterval = DEVICE_COMMAND_INTERVAL - (performance.now() - started);
  if (remainingInterval > 0) await sleep(remainingInterval);
  return matched;
}

async function readDevice() {
  if (!device?.opened) throw new Error("Connect the JA11 first");
  setStatus("Reading hardware and DSP state…");
  hardwareState = { ...EMPTY_HARDWARE_STATE };
  volumeDraft = null;
  uacDraft = null;
  presetDraft = null;
  armedVolume = null;
  renderHardwareState();

  const reads = [
    [requestUacModePacket(), "UAC mode"],
    [requestInlineControlPacket(), "headset control"],
    [requestDeviceVolumePacket(), "device volume"],
    [requestEqPresetPacket(), "EQ program"],
    [requestSampleRatePacket(), "sample rate"],
    [requestFirmwareVersionPacket(), "firmware"],
    [requestMasterGainPacket(), "PEQ preamp"],
    ...Array.from({ length: BAND_COUNT }, (_, index) => [requestBandPacket(index), `band ${index + 1}`]),
  ];
  const missing = [];
  for (const [packet, label] of reads) {
    if (!await sendAndWait(packet)) missing.push(label);
  }
  originalState = clone(state);
  history = [];
  future = [];
  activeInputKey = undefined;
  comparingOriginal = false;
  $("#compare").textContent = "Listen to saved User 1";
  renderState();
  renderHardwareState();
  if (missing.length) setStatus(`Partial read; no response for ${missing.join(", ")}`, "warning");
  else setStatus("Hardware and DSP parameters synchronized", "ok");
}

async function writeAndVerify({ writePacket, readPacket, expected, current, label }) {
  if (!device?.opened) throw new Error("Connect the JA11 first");
  await device.sendReport(REPORT_ID, writePacket);
  await sleep(DEVICE_COMMAND_INTERVAL);
  if (!await sendAndWait(readPacket)) {
    throw new Error(`${label} was sent, but the JA11 did not answer the verification read`);
  }
  if (current() !== expected) {
    throw new Error(`${label} did not verify; the JA11 reported ${String(current())}`);
  }
}

function updateVolumeDraft(value) {
  if (value === "") return;
  const number = clamp(Math.round(Number(value)), 0, 60);
  if (!Number.isFinite(number)) return;
  volumeDraft = number;
  armedVolume = null;
  renderHardwareState();
}

async function applyDeviceVolume() {
  const currentVolume = hardwareState.deviceVolume;
  const target = volumeDraft;
  if (!Number.isInteger(currentVolume) || !Number.isInteger(target) || target === currentVolume) return;

  if (target > currentVolume + 10 && armedVolume !== target) {
    armedVolume = target;
    renderHardwareState();
    setStatus(`Large volume increase ${currentVolume} → ${target}. Press the confirmation button once more.`, "warning");
    return;
  }

  setStatus(`Setting device volume ${currentVolume} → ${target}…`);
  await writeAndVerify({
    writePacket: setDeviceVolumePacket(target),
    readPacket: requestDeviceVolumePacket(),
    expected: target,
    current: () => hardwareState.deviceVolume,
    label: "Device volume",
  });
  armedVolume = null;
  renderHardwareState();
  setStatus(`Device volume set to ${target} / 60`, "ok");
}

async function applyInlineControl(event) {
  const target = event.currentTarget.checked;
  event.currentTarget.disabled = true;
  expectedRestart = "headset mic / remote change";
  setStatus(`${target ? "Enabling" : "Disabling"} headset mic / remote; waiting for JA11 restart…`, "warning");
  showRestartingState();
  try {
    await device.sendReport(REPORT_ID, setInlineControlPacket(target));
    hardwareState.inlineControl = target;
    renderHardwareState();
  } catch (error) {
    expectedRestart = null;
    setConnected(Boolean(device?.opened));
    renderHardwareState();
    throw error;
  }
}

async function applyEqPreset() {
  const target = presetDraft;
  if (!Number.isInteger(target) || target === hardwareState.eqPreset) return;
  setStatus(`Activating ${EQ_PRESET_NAMES[target]}…`);
  await writeAndVerify({
    writePacket: setEqPresetPacket(target),
    readPacket: requestEqPresetPacket(),
    expected: target,
    current: () => hardwareState.eqPreset,
    label: "EQ program",
  });
  renderHardwareState();
  setStatus(`${EQ_PRESET_NAMES[target]} is now the active EQ program`, "ok");
}

async function applyUacMode() {
  const target = uacDraft;
  if (!Number.isInteger(target) || target === hardwareState.uacMode) return;
  const label = target === 0 ? "UAC 1.0" : "UAC 2.0";
  expectedRestart = `${label} change`;
  setStatus(`Switching to ${label}; waiting for JA11 restart…`, "warning");
  showRestartingState();
  try {
    await device.sendReport(REPORT_ID, setUacModePacket(target));
    hardwareState.uacMode = target;
    uacDraft = target;
    renderHardwareState();
  } catch (error) {
    expectedRestart = null;
    setConnected(Boolean(device?.opened));
    renderHardwareState();
    throw error;
  }
}

async function sendSnapshot(snapshot, persist = false) {
  const valid = validatePeqSnapshot(snapshot);
  await device.sendReport(REPORT_ID, setEqPresetPacket(3));
  await sleep(DEVICE_COMMAND_INTERVAL);
  hardwareState.eqPreset = 3;
  presetDraft = 3;
  renderHardwareState();
  for (let index = 0; index < BAND_COUNT; index += 1) {
    await device.sendReport(REPORT_ID, setBandPacket(index, valid.bands[index]));
    await sleep(DEVICE_COMMAND_INTERVAL);
  }
  await device.sendReport(REPORT_ID, setMasterGainPacket(valid.masterGain));
  if (persist) {
    await sleep(DEVICE_COMMAND_INTERVAL);
    await device.sendReport(REPORT_ID, savePacket());
  }
}

async function previewDraft() {
  setStatus("Activating the User 1 draft for listening…");
  await sendSnapshot(state, false);
  comparingOriginal = false;
  $("#compare").textContent = "Listen to saved User 1";
  setStatus("User 1 draft active for listening; persistent memory unchanged", "ok");
}

async function compareOriginal() {
  comparingOriginal = !comparingOriginal;
  setStatus(comparingOriginal ? "Loading saved User 1 for comparison…" : "Returning to current User 1 draft…");
  await sendSnapshot(comparingOriginal ? originalState : state, false);
  $("#compare").textContent = comparingOriginal ? "Return to current draft" : "Listen to saved User 1";
  setStatus(comparingOriginal ? "Listening to saved User 1" : "Listening to current User 1 draft", "ok");
}

async function saveToDevice() {
  setStatus("Writing persistent DSP memory…");
  await sendSnapshot(state, true);
  originalState = clone(state);
  history = [];
  future = [];
  activeInputKey = undefined;
  comparingOriginal = false;
  renderState();
  setStatus("Saved. The JA11 may disconnect briefly while restarting.", "ok");
}

function resetFlat() {
  const previous = clone(state);
  state = { masterGain: 0, bands: clone(DEFAULT_BANDS) };
  activeInputKey = undefined;
  checkpoint(previous);
  renderState();
  setStatus("Flat draft prepared; not sent to the JA11");
}

function restoreOriginal() {
  const previous = clone(state);
  state = clone(originalState);
  activeInputKey = undefined;
  checkpoint(previous);
  renderState();
  setStatus("Saved User 1 values restored in draft");
}

function undo() {
  if (!history.length) return;
  future.push(clone(state));
  state = history.pop();
  activeInputKey = undefined;
  renderState();
  setStatus("Last edit undone");
}

function redo() {
  if (!future.length) return;
  history.push(clone(state));
  state = future.pop();
  activeInputKey = undefined;
  renderState();
  setStatus("Edit restored");
}

function downloadConfig() {
  const snapshot = validatePeqSnapshot(state);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ja11-eq-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const next = validatePeqSnapshot(parsed);
    const previous = clone(state);
    state = next;
    checkpoint(previous);
    renderState();
    setStatus("Configuration imported as a local draft");
  } finally {
    event.target.value = "";
  }
}

function guard(action) {
  return async (...args) => {
    try { await action(...args); }
    catch (error) { setStatus(error.message, "error"); console.error(error); }
  };
}

$("#bands").addEventListener("input", (event) => {
  const row = event.target.closest("tr");
  if (!row || !event.target.dataset.key) return;
  const index = Number(row.dataset.index);
  const key = event.target.dataset.key;
  if (key === "type") {
    beginInputHistory(`band:${index}:${key}`);
    state.bands[index][key] = event.target.value;
    drawResponse();
  } else {
    const valid = hasValidPeqNumber(event.target);
    markInputValidity(event.target, valid);
    if (valid) {
      beginInputHistory(`band:${index}:${key}`);
      state.bands[index][key] = quantizePeqNumber(event.target.valueAsNumber, PEQ_LIMITS[key]);
      drawResponse();
    }
  }
  updateChangeState();
});
function commitBandPeqInput(event) {
  const row = event.target.closest("tr");
  const key = event.target.dataset.key;
  if (!row || !key || key === "type") {
    activeInputKey = undefined;
    return;
  }

  const index = Number(row.dataset.index);
  const previousValue = state.bands[index][key];
  const result = normalizePeqInput(event.target, previousValue, PEQ_LIMITS[key]);
  if (result.value !== previousValue) {
    beginInputHistory(`band:${index}:${key}`);
    state.bands[index][key] = result.value;
    drawResponse();
  }
  activeInputKey = undefined;
  updateChangeState();

  const label = `Band ${index + 1} ${BAND_FIELD_LABELS[key]}`;
  if (result.restored) setStatus(`${label} restored to ${formatPeqNumber(result.value, PEQ_LIMITS[key])}`, "warning");
  else if (result.adjusted) setStatus(`${label} limited to ${formatPeqNumber(result.value, PEQ_LIMITS[key])}`, "warning");
}
$("#bands").addEventListener("change", commitBandPeqInput);
$("#bands").addEventListener("focusout", commitBandPeqInput);

$("#masterGain").addEventListener("input", (event) => {
  const valid = hasValidPeqNumber(event.currentTarget);
  markInputValidity(event.currentTarget, valid);
  if (valid) {
    beginInputHistory("preamp");
    state.masterGain = quantizePeqNumber(event.currentTarget.valueAsNumber, PEQ_LIMITS.masterGain);
    $("#masterGainRange").value = state.masterGain;
    drawResponse();
  }
  updateChangeState();
});
function commitMasterGainInput(event) {
  const previousValue = state.masterGain;
  const result = normalizePeqInput(event.currentTarget, previousValue, PEQ_LIMITS.masterGain);
  if (result.value !== previousValue) {
    beginInputHistory("preamp");
    state.masterGain = result.value;
    $("#masterGainRange").value = result.value;
    drawResponse();
  }
  activeInputKey = undefined;
  updateChangeState();
  if (result.restored) setStatus(`Preamp restored to ${formatPeqNumber(result.value, PEQ_LIMITS.masterGain)} dB`, "warning");
  else if (result.adjusted) setStatus(`Preamp limited to ${formatPeqNumber(result.value, PEQ_LIMITS.masterGain)} dB`, "warning");
}
$("#masterGain").addEventListener("change", commitMasterGainInput);
$("#masterGain").addEventListener("blur", commitMasterGainInput);

$("#masterGainRange").addEventListener("input", (event) => {
  beginInputHistory("preamp");
  state.masterGain = quantizePeqNumber(event.currentTarget.valueAsNumber, PEQ_LIMITS.masterGain);
  $("#masterGain").value = formatPeqNumber(state.masterGain, PEQ_LIMITS.masterGain);
  markInputValidity($("#masterGain"), true);
  drawResponse();
  updateChangeState();
});
$("#masterGainRange").addEventListener("change", () => { activeInputKey = undefined; });

$("#responsePlot").addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".band-handle");
  if (!handle) return;
  dragStart = clone(state);
  dragIndex = Number(handle.dataset.index);
  $("#responsePlot").setPointerCapture(event.pointerId);
});
$("#responsePlot").addEventListener("pointermove", (event) => {
  if (!dragStart || dragIndex === undefined) return;
  const rect = $("#responsePlot").getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 900;
  const y = ((event.clientY - rect.top) / rect.height) * 380;
  const index = dragIndex;
  state.bands[index].freq = Math.round(frequencyForX(x));
  state.bands[index].gain = Number(clamp(gainForY(y) - Number(state.masterGain), -12, 12).toFixed(1));
  updateBandInputs(index);
  drawResponse();
  updateChangeState();
});
$("#responsePlot").addEventListener("pointerup", () => {
  if (!dragStart) return;
  checkpoint(dragStart);
  dragStart = undefined;
  dragIndex = undefined;
});
$("#responsePlot").addEventListener("keydown", (event) => {
  const handle = event.target.closest(".band-handle");
  if (!handle || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const previous = clone(state);
  const index = Number(handle.dataset.index);
  const band = state.bands[index];
  const gainStep = event.shiftKey ? 1 : 0.1;
  const frequencyRatio = event.shiftKey ? 1.25 : 1.05;
  if (event.key === "ArrowLeft") band.freq = Math.round(clamp(band.freq / frequencyRatio, 20, 20000));
  if (event.key === "ArrowRight") band.freq = Math.round(clamp(band.freq * frequencyRatio, 20, 20000));
  if (event.key === "ArrowUp") band.gain = Number(clamp(band.gain + gainStep, -12, 12).toFixed(1));
  if (event.key === "ArrowDown") band.gain = Number(clamp(band.gain - gainStep, -12, 12).toFixed(1));
  checkpoint(previous);
  renderState();
  $(`#plotHandles .band-handle[data-index="${index}"]`)?.focus();
});

$("#connect").addEventListener("click", guard(connect));
$("#themeToggle").addEventListener("click", toggleTheme);
$("#read").addEventListener("click", guard(readDevice));
$("#deviceVolume").addEventListener("input", (event) => updateVolumeDraft(event.currentTarget.value));
$("#deviceVolumeNumber").addEventListener("input", (event) => updateVolumeDraft(event.currentTarget.value));
$("#applyVolume").addEventListener("click", guard(applyDeviceVolume));
$("#inlineControl").addEventListener("change", guard(applyInlineControl));
$("#uacMode").addEventListener("change", (event) => {
  uacDraft = Number(event.currentTarget.value);
  renderHardwareState();
});
$("#applyUac").addEventListener("click", guard(applyUacMode));
$("#eqPreset").addEventListener("change", (event) => {
  presetDraft = Number(event.currentTarget.value);
  renderHardwareState();
});
$("#applyPreset").addEventListener("click", guard(applyEqPreset));
$("#compare").addEventListener("click", guard(compareOriginal));
$("#preview").addEventListener("click", guard(previewDraft));
$("#save").addEventListener("click", guard(saveToDevice));
$("#flat").addEventListener("click", resetFlat);
$("#revert").addEventListener("click", restoreOriginal);
$("#undo").addEventListener("click", undo);
$("#redo").addEventListener("click", redo);
$("#export").addEventListener("click", guard(downloadConfig));
$("#importFile").addEventListener("change", guard(importConfig));

navigator.hid?.addEventListener("disconnect", (event) => {
  if (event.device !== device) return;
  setConnected(false);
  if (expectedRestart) {
    const reason = expectedRestart;
    expectedRestart = null;
    setStatus(`JA11 restarted after ${reason}. Select Connect JA11 to read the new state.`, "warning");
  } else {
    setStatus("JA11 disconnected. A brief restart is normal after saving.", "error");
  }
});

renderPlotGrid();
updateThemeControl();
renderState();
setConnected(false);
if (!("hid" in navigator)) {
  setStatus("WebHID unavailable here. Open this address in Chrome, Edge, or Opera.", "error");
  $("#connect").textContent = "WebHID unavailable";
  $("#connect").disabled = true;
}
