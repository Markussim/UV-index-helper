import { DateTime } from "luxon";

/**
 * Representative MED (Minimal Erythema Dose) in SED by Fitzpatrick type.
 * Very approximate; tune to your needs.
 */
export const MED_SED = { I: 2.5, II: 3.5, III: 4.5, IV: 6.0, V: 8.0, VI: 12.0 };

function uvIndexToEryIrradiance_Wm2(uvi) {
  // Erythemal irradiance (W/m²) = UVI * 0.025
  return uvi * 0.025;
}

/**
 * Integrate erythemal dose between [start, end] using trapezoids on hourly UVI points.
 * Returns dose in SED (1 SED = 100 J/m²).
 */
export function doseSEDFromHourlyUVI({
  timesISO,
  uviValues,
  zone,
  start,
  end,
}) {
  let doseJm2 = 0;

  for (let i = 0; i < timesISO.length - 1; i++) {
    const t0 = DateTime.fromISO(timesISO[i], { zone });
    const t1 = DateTime.fromISO(timesISO[i + 1], { zone });

    // overlap this hour-segment with [start, end]
    const segStart = t0 > start ? t0 : start;
    const segEnd = t1 < end ? t1 : end;
    if (segEnd <= segStart) continue;

    const u0 = uviValues[i];
    const u1 = uviValues[i + 1];

    // trapezoid average irradiance
    const E0 = uvIndexToEryIrradiance_Wm2(u0);
    const E1 = uvIndexToEryIrradiance_Wm2(u1);
    const Eavg = (E0 + E1) / 2;

    const dtSeconds = segEnd.diff(segStart, "seconds").seconds;
    doseJm2 += Eavg * dtSeconds; // W/m² * s = J/m²
  }

  return doseJm2 / 100.0; // J/m² -> SED
}

function getZoneAndSeries(apiData) {
  const zone = apiData.timezone || "UTC";
  const timesISO = apiData.hourly?.time ?? [];
  const uviValues = apiData.hourly?.uv_index ?? [];
  if (timesISO.length < 2 || uviValues.length !== timesISO.length) {
    throw new Error(
      "Bad input: hourly.time and hourly.uv_index must exist and have same length >= 2",
    );
  }
  return { zone, timesISO, uviValues };
}

function restOfDayWindow(zone) {
  const now = DateTime.now().setZone(zone);
  // "rest of the day" as until next midnight (cleaner than endOf('day') for integration)
  const end = now.plus({ days: 1 }).startOf("day");
  return { now, end };
}

/**
 * 1) Percent of exposure used if you go outside RIGHT NOW and stay out for the rest of the day.
 * - limitFraction = 1.0 means 100% corresponds to MED (your "sunscreen needed at 100%").
 * - limitFraction = 0.75 means 100% corresponds to 75% of MED (built-in safety margin).
 */
export function percentExposureIfOutsideNow(
  apiData,
  skinType = "III",
  limitFraction = 1.0,
) {
  const { zone, timesISO, uviValues } = getZoneAndSeries(apiData);
  const { now, end } = restOfDayWindow(zone);

  const med = MED_SED[skinType];
  if (!med)
    throw new Error(
      `Unknown skinType: ${skinType} (use I, II, III, IV, V, VI)`,
    );

  const doseSED = doseSEDFromHourlyUVI({
    timesISO,
    uviValues,
    zone,
    start: now,
    end,
  });
  const thresholdSED = med * limitFraction;

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

/**
 * 2) If staying outside from NOW to midnight is unsafe (>100%),
 * return the time when it becomes safe to go outside and stay outside for the rest of the day
 * without exceeding the limit.
 *
 * Returns:
 * - { status: "right_now", safeTimeISO: now } if it never becomes unsafe (i.e., already safe now)
 * - { status: "later", safeTimeISO: someTime } if you need to wait
 *
 * Uses a binary search for the latest-needed waiting time (monotonic because UVI >= 0).
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
  if (!med)
    throw new Error(
      `Unknown skinType: ${skinType} (use I, II, III, IV, V, VI)`,
    );

  const thresholdSED = med * limitFraction;

  const doseNow = doseSEDFromHourlyUVI({
    timesISO,
    uviValues,
    zone,
    start: now,
    end,
  });
  if (doseNow <= thresholdSED) {
    return { status: "right_now", safeTimeISO: now.toISO(), zone };
  }

  // Binary search for earliest time t such that dose(t -> end) <= threshold
  let lo = now;
  let hi = end;

  while (hi.diff(lo, "seconds").seconds > precisionSeconds) {
    const mid = lo.plus({ seconds: hi.diff(lo, "seconds").seconds / 2 });
    const doseMid = doseSEDFromHourlyUVI({
      timesISO,
      uviValues,
      zone,
      start: mid,
      end,
    });

    if (doseMid <= thresholdSED) {
      // safe if you start at mid, so try earlier
      hi = mid;
    } else {
      // still unsafe; must wait longer
      lo = mid;
    }
  }

  return { status: "later", safeTimeISO: hi.toISO(), zone };
}
