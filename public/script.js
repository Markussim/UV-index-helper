// http://localhost:3000/api?lat=34.05&lon=-118.25

const form = document.getElementById("coordinateForm");

const lat = document.getElementById("lat");
const lon = document.getElementById("lon");

let countdownTimerId = null;
let refreshTimerId = null;
let currentAbort = null;

function clearActiveWork() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  if (refreshTimerId) clearTimeout(refreshTimerId);
  countdownTimerId = null;
  refreshTimerId = null;

  if (currentAbort) currentAbort.abort();
  currentAbort = null;
}

function formatHHMM(date, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h24",
    timeZone,
  }).format(date);
}

function timeUntil(date) {
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);

  if (Math.abs(diffSec) < 30) return "now";

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");

  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");

  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");

  const diffDay = Math.round(diffHr / 24);
  return rtf.format(diffDay, "day");
}

function renderGoOut(data) {
  let goOut = null;

  if (data.safeToGoOutside.status === "right_now") {
    goOut = "It is safe to go outside now ✅";
  } else if (data.safeToGoOutside.status === "later") {
    const iso = data.safeToGoOutside.safeTimeISO;
    const destZone = data.safeToGoOutside.zone;
    const userZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const instant = new Date(iso);

    let destTime = formatHHMM(instant, destZone);
    const localTime = formatHHMM(instant, userZone);

    const until = timeUntil(instant);

    // Only show "(local time: ...)" if it would display something different
    if (
      userZone &&
      destZone &&
      userZone !== destZone &&
      localTime !== destTime
    ) {
      goOut = `It is safe to go out at ${destTime} (${localTime} local time) — ${until}`;
    } else {
      goOut = `It is safe to go out at ${destTime} — ${until}`;
    }
  }

  document.getElementById("goOut").innerText = goOut ?? "";
}

async function fetchAndStart(latValue, lonValue) {
  clearActiveWork();

  currentAbort = new AbortController();

  const response = await fetch(`/api?lat=${latValue}&lon=${lonValue}`, {
    signal: currentAbort.signal,
  });
  const data = await response.json();

  // Render once now
  renderGoOut(data);

  // Update safety index etc. (your existing code can stay)
  document.getElementById("safetyindex").innerText =
    data.safetyIndexNow.toFixed(1) + "%";

  // Start ticking (recompute "in X minutes" without re-fetching)
  countdownTimerId = setInterval(() => {
    renderGoOut(data);
  }, 1000); // or 10_000 / 60_000 if you prefer less frequent updates

  // Schedule refresh from API every minute
  refreshTimerId = setTimeout(
    async () => {
      try {
        await fetchAndStart(latValue, lonValue); // refresh data + restart timers cleanly
      } catch (e) {
        // If aborted because user submitted new coords, ignore
        if (e.name !== "AbortError") console.error(e);
      }
    },
    1 * 60 * 1000,
  );

  return data;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("displayContainer").style.display = "none";

  const locationResponse = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.value}&lon=${lon.value}`,
  );

  const data = await fetchAndStart(lat.value, lon.value);

  const locationData = await locationResponse.json();

  let location = null;

  if (locationData.address) {
    if (locationData.address.city) {
      location = locationData.address.city;
    } else if (locationData.address.municipality) {
      location = locationData.address.municipality;
    } else {
      location = locationData.address.country;
    }
  } else {
    location = "the middle of nowhere";
  }

  document.getElementById("location").innerText = location;

  document.getElementById("displayContainer").style.display = "block";
});

const getPosition = document.getElementById("fetch");

getPosition.addEventListener("click", async (e) => {
  e.preventDefault();
  getPosition.disabled = true;

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        lat.value = position.coords.latitude;
        lon.value = position.coords.longitude;

        document.getElementById("accuracy").innerText =
          "Position accuracy: " +
          Intl.NumberFormat("sv-se", { maximumSignificantDigits: 3 }).format(
            position.coords.accuracy,
          ) +
          "m";

        form.requestSubmit(); // triggers your form's submit listener

        getPosition.disabled = false;
      },
      undefined,
      {
        enableHighAccuracy: true,
      },
    );
  } else {
    console.error("No geolocation available");
  }
});

function timeUntil(date) {
  const diffMs = date.getTime() - Date.now(); // future => positive
  const diffSec = Math.round(diffMs / 1000);

  // "now" threshold (optional)
  if (Math.abs(diffSec) < 30) return "now";

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");

  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");

  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");

  const diffDay = Math.round(diffHr / 24);
  return rtf.format(diffDay, "day");
}
