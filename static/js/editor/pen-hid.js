/**
 * WebHID pen-pressure bridge — gets real stylus pressure (and tilt) with
 * Windows Ink turned OFF, which the Pointer Events API can't provide on Windows
 * (it only carries pressure when Ink routes the pen as a Windows pointer; with
 * Ink off the browser sees a plain mouse). Native apps read WinTab; a web page
 * can't, but it CAN claim the tablet as a raw HID device and decode the
 * "Tip Pressure" field straight from its input reports — bypassing both Ink and
 * WinTab. Position still comes from the mouse/pointer (we only borrow pressure +
 * tilt), so no tablet→screen coordinate mapping is needed.
 *
 * The bit-field decode (buildFieldMap / readBits) is pure + unit-tested; the
 * connect() handshake needs a real tablet + a user gesture (Chromium/Edge only,
 * secure context). On connect we set state.pressure / state.tiltX / state.tiltY
 * from each input report, exactly where capturePen would — so the brush engine's
 * dynamics work unchanged.
 *
 * Digitizer usages (HID Usage Tables): page 0x0D — Tip Pressure 0x30,
 * X Tilt 0x3D, Y Tilt 0x3E. Generic Desktop page 0x01 — X 0x30, Y 0x31.
 */
import { state } from './state.js';

const WANT = {
  pressure: [0x0D, 0x30],
  tiltX: [0x0D, 0x3D],
  tiltY: [0x0D, 0x3E],
};

// Read `bitSize` bits at `bitOffset` from a DataView, LSB-first (HID order).
export function readBits(view, bitOffset, bitSize) {
  let val = 0;
  for (let i = 0; i < bitSize; i++) {
    const byteIdx = (bitOffset + i) >> 3;
    const bitIdx = (bitOffset + i) & 7;
    const bit = byteIdx < view.byteLength ? (view.getUint8(byteIdx) >> bitIdx) & 1 : 0;
    val |= bit << i;
  }
  return val >>> 0;
}

// Walk a device's parsed collections → { reportId, bitOffset, bitSize, logicalMax }
// for each wanted usage. Bit offsets are relative to the report PAYLOAD (the
// reportId byte is delivered separately by the inputreport event).
export function buildFieldMap(collections) {
  const map = {};
  for (const col of collections || []) {
    for (const rep of col.inputReports || []) {
      let bit = 0;
      for (const item of rep.items || []) {
        const size = item.reportSize || 0;
        const count = item.reportCount || 0;
        const usages = item.usages || [];
        for (let j = 0; j < count; j++) {
          const u = usages.length ? (usages[Math.min(j, usages.length - 1)] >>> 0) : 0;
          const page = (u >>> 16) & 0xFFFF, usage = u & 0xFFFF;
          for (const key in WANT) {
            if (!map[key] && WANT[key][0] === page && WANT[key][1] === usage) {
              map[key] = {
                reportId: rep.reportId || 0,
                bitOffset: bit + j * size,
                bitSize: size,
                logicalMax: (item.logicalMaximum && item.logicalMaximum > 0) ? item.logicalMaximum : ((1 << size) - 1) || 1,
                logicalMin: item.logicalMinimum || 0,
              };
            }
          }
        }
        bit += size * count;
      }
    }
  }
  return map;
}

export function createPenHid({ onStatus } = {}) {
  let device = null;
  let fieldMap = null;
  const status = (s) => { try { onStatus && onStatus(s); } catch {} };

  function supported() { return typeof navigator !== 'undefined' && !!navigator.hid; }

  function onInputReport(e) {
    if (!fieldMap) return;
    const view = e.data; // DataView, reportId stripped
    const rid = e.reportId || 0;
    const f = fieldMap.pressure;
    if (f && (f.reportId === rid || f.reportId === 0)) {
      const raw = readBits(view, f.bitOffset, f.bitSize);
      const span = Math.max(1, f.logicalMax - f.logicalMin);
      let p = (raw - f.logicalMin) / span;
      p = p < 0 ? 0 : p > 1 ? 1 : p;
      // Only trust it while the pen is in contact (pressure > 0); a 0 reading
      // means hover — leave the last value so a lift doesn't zero mid-stroke.
      if (p > 0) { state.isPen = true; state.pressure = p; }
    }
    for (const [k, sk] of [['tiltX', 'tiltX'], ['tiltY', 'tiltY']]) {
      const tf = fieldMap[k];
      if (tf && (tf.reportId === rid || tf.reportId === 0)) {
        const raw = readBits(view, tf.bitOffset, tf.bitSize);
        // Tilt is signed-ish degrees; map logical range to roughly [-60, 60].
        const span = Math.max(1, tf.logicalMax - tf.logicalMin);
        const norm = (raw - tf.logicalMin) / span; // 0..1
        state[sk] = Math.round((norm * 2 - 1) * 60);
      }
    }
  }

  async function connect() {
    if (!supported()) { status('WebHID not supported in this browser'); return false; }
    let devices;
    try {
      devices = await navigator.hid.requestDevice({ filters: [{ usagePage: 0x0D }] }); // Digitizer
    } catch (e) { status('Tablet selection cancelled'); return false; }
    if (!devices || !devices.length) { status('No tablet selected'); return false; }
    device = devices[0];
    try { if (!device.opened) await device.open(); } catch (e) { status('Could not open tablet'); return false; }
    fieldMap = buildFieldMap(device.collections);
    if (!fieldMap.pressure) { status('No pressure field found on this device'); }
    device.addEventListener('inputreport', onInputReport);
    state.penHidActive = true;
    status('Tablet connected — pressure live (Windows Ink can stay off)');
    return true;
  }

  async function disconnect() {
    if (device) {
      try { device.removeEventListener('inputreport', onInputReport); } catch {}
      try { await device.close(); } catch {}
    }
    device = null; fieldMap = null; state.penHidActive = false;
    status('Tablet disconnected');
  }

  return { connect, disconnect, supported, isConnected: () => !!device, get fieldMap() { return fieldMap; } };
}
