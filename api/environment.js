const SCHOOL_LATITUDE = 37.467;
const SCHOOL_LONGITUDE = 126.932;

function weatherLabel(code) {
  const labels = {
    0: "맑음",
    1: "대체로 맑음",
    2: "구름 조금",
    3: "흐림",
    45: "안개",
    48: "안개",
    51: "이슬비",
    53: "이슬비",
    55: "이슬비",
    61: "비",
    63: "비",
    65: "강한 비",
    71: "눈",
    73: "눈",
    75: "강한 눈",
    80: "소나기",
    81: "소나기",
    82: "강한 소나기",
    95: "뇌우"
  };
  return labels[code] || "날씨 확인";
}

function airQualityLabel(pm25 = 0) {
  if (pm25 <= 15) return "좋음";
  if (pm25 <= 35) return "보통";
  if (pm25 <= 75) return "나쁨";
  return "매우나쁨";
}

function nearestHourlyValue(hourly, key) {
  const times = hourly?.time || [];
  const values = hourly?.[key] || [];
  if (!times.length || !values.length) return null;

  const now = Date.now();
  let bestIndex = 0;
  let bestDistance = Infinity;
  times.forEach((time, index) => {
    const distance = Math.abs(new Date(`${time}:00+09:00`).getTime() - now);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return values[bestIndex] ?? null;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.search = new URLSearchParams({
      latitude: String(SCHOOL_LATITUDE),
      longitude: String(SCHOOL_LONGITUDE),
      current: "temperature_2m,weather_code",
      timezone: "Asia/Seoul"
    }).toString();

    const airUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    airUrl.search = new URLSearchParams({
      latitude: String(SCHOOL_LATITUDE),
      longitude: String(SCHOOL_LONGITUDE),
      hourly: "pm10,pm2_5",
      timezone: "Asia/Seoul"
    }).toString();

    const [weatherResponse, airResponse] = await Promise.all([fetch(weatherUrl), fetch(airUrl)]);
    if (!weatherResponse.ok) throw new Error(`Weather request failed: ${weatherResponse.status}`);
    if (!airResponse.ok) throw new Error(`Air quality request failed: ${airResponse.status}`);

    const [weather, air] = await Promise.all([weatherResponse.json(), airResponse.json()]);
    const pm25 = nearestHourlyValue(air.hourly, "pm2_5");
    const pm10 = nearestHourlyValue(air.hourly, "pm10");
    const code = weather.current?.weather_code;

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      weather: {
        temperature: weather.current?.temperature_2m ?? null,
        label: weatherLabel(code)
      },
      air: {
        label: airQualityLabel(Number(pm25) || 0),
        pm25,
        pm10
      }
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Failed to load environment data" });
  }
};
