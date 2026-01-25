import { DateTime } from "luxon";

export const MED_SED = { I: 2.5, II: 3.5, III: 4.5, IV: 6.0, V: 8.0, VI: 12.0 };

const UVI_TO_WM2 = 0.025; // erythemal irradiance W/m² per UVI
const JM2_TO_SED = 1 / 100.0;

function getZoneAndSeries(apiData) {
  const zone = apiData.timezone || "UTC";
  const timesISO = apiData.hourly?.time ?? [];
  const uviValues = apiData.hourly?.uv_index ?? [];
  if (timesISO.length < 2 || uviValues.length !== timesISO.length) {
    throw new Error(
      "Bad input: hourly.time and hourly.uv_index must exist and match length >= 2",
    );
  }
  return { zone, timesISO, uviValues };
}

function restOfDayWindow(zone) {
  const now = DateTime.now().setZone(zone);
  const end = now.plus({ days: 1 }).startOf("day");
  return { now, end };
}

function lowerBound(arr, x) {
  // first index i such that arr[i] >= x
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * FAST: Precompute dose remaining to midnight, then binary search time.
 */
export function safeStartTimeForRestOfDay(
  apiData,
  skinType = "III",
  limitFraction = 1.0,
  precisionSeconds = 60,
) {
  const { zone, timesISO, uviValues } = getZoneAndSeries(apiData);
  const { now, end } = restOfDayWindow(zone);

  const med = MED_SED[skinType];
  if (!med) throw new Error(`Unknown skinType: ${skinType}`);

  const thresholdSED = med * limitFraction;
  const nowMs = now.toMillis();
  const endMs = end.toMillis();

  // Parse times once (this is cheap vs parsing them ~10x)
  const timesMsAll = timesISO.map((t) =>
    DateTime.fromISO(t, { zone }).toMillis(),
  );

  // We need coverage spanning [now, end]
  // Find indices around now and end
  const iNow = Math.max(0, lowerBound(timesMsAll, nowMs) - 1);
  const iEnd = Math.max(0, lowerBound(timesMsAll, endMs) - 1);

  // Build clipped arrays starting at iNow up to iEnd+1, then add an interpolated point at endMs
  let timesMs = timesMsAll.slice(iNow, Math.min(iEnd + 2, timesMsAll.length));
  let uvi = uviValues.slice(iNow, Math.min(iEnd + 2, uviValues.length));

  if (timesMs.length < 2) {
    // Not enough data in the feed; treat as safe
    return { status: "right_now", safeTimeISO: now.toISO(), zone };
  }

  // Ensure last point is exactly endMs (midnight), add interpolated UVI if needed
  const lastT = timesMs[timesMs.length - 1];
  if (lastT < endMs) {
    // end is beyond last known point in this slice; treat remaining as 0 UVI
    timesMs.push(endMs);
    uvi.push(0);
  } else if (lastT > endMs) {
    // end falls inside the last segment; interpolate UVI at endMs
    const t0 = timesMs[timesMs.length - 2];
    const t1 = timesMs[timesMs.length - 1];
    const u0 = uvi[uvi.length - 2];
    const u1 = uvi[uvi.length - 1];
    const x = (endMs - t0) / (t1 - t0);
    const uEnd = u0 + (u1 - u0) * x;

    timesMs[timesMs.length - 1] = endMs;
    uvi[uvi.length - 1] = uEnd;
  }

  const n = timesMs.length;

  // Precompute full-segment doses and suffix sums: suffix[i] = dose from timesMs[i] to endMs
  const segDose = new Array(n - 1).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dtSec = (timesMs[i + 1] - timesMs[i]) / 1000;
    const u0 = uvi[i];
    const u1 = uvi[i + 1];
    // trapezoid of UVI, then scale to W/m², integrate over seconds, convert to SED
    segDose[i] = ((u0 + u1) / 2) * UVI_TO_WM2 * dtSec * JM2_TO_SED;
  }

  const suffix = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    suffix[i] = suffix[i + 1] + segDose[i];
  }

  // Fast dose from arbitrary tMs to endMs
  function doseFrom(tMs) {
    if (tMs >= endMs) return 0;
    if (tMs <= timesMs[0]) {
      // starting before our slice: approximate with slice start
      return suffix[0];
    }

    const j = Math.max(0, lowerBound(timesMs, tMs) - 1); // segment j: [timesMs[j], timesMs[j+1])
    const t0 = timesMs[j],
      t1 = timesMs[j + 1];
    const u0 = uvi[j],
      u1 = uvi[j + 1];

    const dt = (t1 - t0) / 1000;
    const dtRemain = (t1 - tMs) / 1000;
    const xStart = (tMs - t0) / (t1 - t0);
    const uStart = u0 + (u1 - u0) * xStart;

    const partial = ((uStart + u1) / 2) * UVI_TO_WM2 * dtRemain * JM2_TO_SED;
    return partial + suffix[j + 1];
  }

  // Check now
  if (doseFrom(nowMs) <= thresholdSED) {
    return { status: "right_now", safeTimeISO: now.toISO(), zone };
  }

  // Binary search on time using fast doseFrom()
  let lo = nowMs;
  let hi = endMs;
  const epsMs = precisionSeconds * 1000;

  while (hi - lo > epsMs) {
    const mid = lo + (hi - lo) / 2;
    if (doseFrom(mid) <= thresholdSED) hi = mid;
    else lo = mid;
  }

  return {
    status: "later",
    safeTimeISO: DateTime.fromMillis(hi, { zone }).toISO(),
    zone,
  };
}

export function percentExposureIfOutsideNow(
  apiData,
  skinType = "III",
  limitFraction = 1.0,
) {
  const { zone, timesISO, uviValues } = getZoneAndSeries(apiData);
  const { now, end } = restOfDayWindow(zone);

  const med = MED_SED[skinType];
  if (!med) throw new Error(`Unknown skinType: ${skinType}`);

  const thresholdSED = med * limitFraction;

  // Use the same fast machinery as safeStartTimeForRestOfDay:
  const nowMs = now.toMillis();
  const endMs = end.toMillis();

  const timesMsAll = timesISO.map((t) =>
    DateTime.fromISO(t, { zone }).toMillis(),
  );

  const iNow = Math.max(0, lowerBound(timesMsAll, nowMs) - 1);
  const iEnd = Math.max(0, lowerBound(timesMsAll, endMs) - 1);

  let timesMs = timesMsAll.slice(iNow, Math.min(iEnd + 2, timesMsAll.length));
  let uvi = uviValues.slice(iNow, Math.min(iEnd + 2, uviValues.length));

  if (timesMs.length < 2) {
    return {
      zone,
      now: now.toISO(),
      end: end.toISO(),
      skinType,
      limitFraction,
      doseSED: 0,
      thresholdSED,
      percent: 0,
    };
  }

  const lastT = timesMs[timesMs.length - 1];
  if (lastT < endMs) {
    timesMs.push(endMs);
    uvi.push(0);
  } else if (lastT > endMs) {
    const t0 = timesMs[timesMs.length - 2];
    const t1 = timesMs[timesMs.length - 1];
    const u0 = uvi[uvi.length - 2];
    const u1 = uvi[uvi.length - 1];
    const x = (endMs - t0) / (t1 - t0);
    const uEnd = u0 + (u1 - u0) * x;

    timesMs[timesMs.length - 1] = endMs;
    uvi[uvi.length - 1] = uEnd;
  }

  const n = timesMs.length;

  const segDose = new Array(n - 1).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dtSec = (timesMs[i + 1] - timesMs[i]) / 1000;
    const u0 = uvi[i];
    const u1 = uvi[i + 1];
    segDose[i] = ((u0 + u1) / 2) * UVI_TO_WM2 * dtSec * JM2_TO_SED;
  }

  const suffix = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) suffix[i] = suffix[i + 1] + segDose[i];

  function doseFrom(tMs) {
    if (tMs >= endMs) return 0;
    if (tMs <= timesMs[0]) return suffix[0];

    const j = Math.max(0, lowerBound(timesMs, tMs) - 1);
    const t0 = timesMs[j],
      t1 = timesMs[j + 1];
    const u0 = uvi[j],
      u1 = uvi[j + 1];

    const dtRemain = (t1 - tMs) / 1000;
    const xStart = (tMs - t0) / (t1 - t0);
    const uStart = u0 + (u1 - u0) * xStart;

    const partial = ((uStart + u1) / 2) * UVI_TO_WM2 * dtRemain * JM2_TO_SED;
    return partial + suffix[j + 1];
  }

  const doseSED = doseFrom(nowMs);
  const percent = (doseSED / thresholdSED) * 100;

  return {
    zone,
    now: now.toISO(),
    end: end.toISO(),
    skinType,
    limitFraction,
    doseSED,
    thresholdSED,
    percent,
  };
}
