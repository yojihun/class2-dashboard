const ATPT_OFCDC_SC_CODE = "B10";
const SD_SCHUL_CODE = "7011569";

function todayKst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).replace(/-/g, "");
}

function parseDishes(ddishNm) {
  return String(ddishNm || "")
    .split(/<br\s*\/?>/i)
    .map((dish) => dish.replace(/\s*\([^)]+\)\s*/g, "").trim())
    .filter(Boolean);
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const date = todayKst();
  const params = new URLSearchParams({
    Type: "json",
    ATPT_OFCDC_SC_CODE,
    SD_SCHUL_CODE,
    MLSV_YMD: date
  });
  const key = process.env.NEIS_API_KEY;
  if (key) params.set("KEY", key);

  try {
    const response = await fetch(`https://open.neis.go.kr/hub/mealServiceDietInfo?${params}`);
    if (!response.ok) throw new Error(`NEIS request failed: ${response.status}`);

    const data = await response.json();

    if (data?.RESULT?.CODE === "INFO-200" || !data?.mealServiceDietInfo) {
      res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
      res.status(200).json({ meals: [], date });
      return;
    }

    const rows = data.mealServiceDietInfo?.[1]?.row || [];
    const meals = rows.map((row) => ({
      type: row.MMEAL_SC_NM || "",
      typeCode: row.MMEAL_SC_CODE || "",
      dishes: parseDishes(row.DDISH_NM),
      calories: row.CAL_INFO || null
    }));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    res.status(200).json({ meals, date });
  } catch (error) {
    res.status(502).json({ error: error.message || "Failed to load meal data" });
  }
};
