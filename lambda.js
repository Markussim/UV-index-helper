import serverless from "serverless-http";
import axios from "axios";
import {
  percentExposureIfOutsideNow,
  safeStartTimeForRestOfDay,
} from "./lib.js";
import express from "express";

const app = express();

app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const skinTypeParam = req.query.skinType || "II";

  if (isNaN(lat) || isNaN(lon)) {
    res
      .status(400)
      .send("Please provide valid 'lat' and 'lon' query parameters.");
    return;
  }

  try {
    const uvIndexData = await getUVIndex(lat, lon);

    const outsideNow = percentExposureIfOutsideNow(
      uvIndexData,
      skinTypeParam,
      1,
    );

    const safeToGoOutside = safeStartTimeForRestOfDay(
      uvIndexData,
      skinTypeParam,
      2,
    );

    res.json({
      safetyIndexNow: outsideNow.percent,
      safeToGoOutside,
    });
  } catch (error) {
    console.error("Error in API:", error);
    res.status(500).send("Internal server error");
  }
});

const getUVIndex = async (lat, lon) => {
  try {
    const response = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index&timezone=auto`,
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching UV index data:", error);
    throw error;
  }
};

export const handler = serverless(app);
