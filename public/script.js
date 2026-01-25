// http://localhost:3000/api?lat=34.05&lon=-118.25

const form = document.getElementById("coordinateForm");

const lat = document.getElementById("lat");
const lon = document.getElementById("lon");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("displayContainer").style.display = "none";

  const response = await fetch(`/api?lat=${lat.value}&lon=${lon.value}`);

  const data = await response.json();

  let goOut = null;

  if (data.safeToGoOutside.status == "right_now") {
    goOut = "It is safe to go outside now ✅";
  }
  if (data.safeToGoOutside.status == "later") {
    let niceDate = new Date(
      data.safeToGoOutside.safeTimeISO,
    ).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h24",
    });

    console.log(data.safeToGoOutside.safeTimeISO);

    goOut = "It is safe to go out at " + niceDate;
  }

  document.getElementById("goOut").innerText = goOut;

  document.getElementById("safetyindex").innerText =
    data.safetyIndexNow.toFixed(1) + "%";

  const locationResponse = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.value}&lon=${lon.value}`,
  );

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
