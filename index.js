import axios from "axios";
import {
  percentExposureIfOutsideNow,
  safeStartTimeForRestOfDay,
} from "./lib.js";
import fs from "fs";

import express from "express";
const app = express();
const port = 3000;

app.get("/", async (req, res) => {
  // Get latitude and longitude from query parameters
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon)) {
    res
      .status(400)
      .send("Please provide valid 'lat' and 'lon' query parameters.");
    return;
  }

  try {
    const uvIndexData = await getUVIndex(lat, lon);

    const outsideNow = percentExposureIfOutsideNow(uvIndexData, "II", 1);

    const safeToGoOutside = safeStartTimeForRestOfDay(uvIndexData, "II", 2);
    res.json({
      safetyIndexNow: outsideNow.percent,
      safeToGoOutside,
    });
  } catch (error) {
    console.error("Error in main function:", error);
    res.status(500).send("Internal server error");
  }
});

app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});

const getUVIndex = async (lat, lon) => {
  try {
    // Check if cache folder exists, if not create it
    if (!fs.existsSync("cache")) {
      fs.mkdirSync("cache");
    }

    let latLonHash = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
    let cacheFile = `cache/uv_cache_${latLonHash}.json`;

    // Check if cached data exists in cache folder
    if (fs.existsSync(cacheFile)) {
      let cachedData = fs.readFileSync(cacheFile, "utf-8");
      return JSON.parse(cachedData);
    }

    const response = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index&timezone=auto`,
    );

    // Cache the response data
    fs.writeFileSync(cacheFile, JSON.stringify(response.data), "utf-8");

    return response.data;
  } catch (error) {
    console.error("Error fetching UV index data:", error);
    throw error;
  }
};

let locations = [
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Bangkok", lat: 13.7563, lon: 100.5018 },
  { name: "Sydney", lat: -33.8688, lon: 151.2093 },
  { name: "Stockholm", lat: 59.3293, lon: 18.0686 },
  { name: "Rio de Janeiro", lat: -22.9068, lon: -43.1729 },
  { name: "Santiago", lat: -33.4489, lon: -70.6693 },
  { name: "Brisbane", lat: -27.4698, lon: 153.0251 },
];

async function main() {
  // Find location by name
  const locationName = "Bangkok";
  const location = locations.find((loc) => loc.name === locationName);

  if (!location) {
    console.error("Location not found:", locationName);
    return;
  }

  const { lat, lon } = location;

  try {
    const uvIndexData = await getUVIndex(lat, lon);

    const outsideNow = percentExposureIfOutsideNow(uvIndexData, "II", 1);

    console.log(
      "Safety index if you go out now: " + outsideNow.percent.toFixed(2) + "%",
    );

    const safeToGoOutside = safeStartTimeForRestOfDay(uvIndexData, "I", 2);

    if (safeToGoOutside.status === "right_now") {
      console.log("Safe to go outside for the rest of the day");
      return;
    }

    let safeTime = new Date(safeToGoOutside.safeTimeISO).toLocaleString(
      "sv-SE",
      {
        timeZone: safeToGoOutside.zone,
      },
    );
    console.log("Safe to go outside at: " + safeTime);
  } catch (error) {
    console.error("Error in main function:", error);
  }
}
