const TODAY_SHEET_ID = "1SzXgcGveGAhkl0_SvMlV2t2dRLvIGFZCWg4ybydJHHM";

function parseGvizResponse(text) {
  const match = String(text).match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?$/);
  if (!match) throw new Error("Invalid Google Sheet response");
  return JSON.parse(match[1]);
}

function cellValue(cell) {
  if (!cell) return "-";
  const raw = cell.formattedValue ?? cell.v ?? "-";
  return String(raw).trim() || "-";
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const url = `https://docs.google.com/spreadsheets/d/${TODAY_SHEET_ID}/gviz/tq?range=A1:G1&tqx=out:json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google Sheet request failed: ${response.status}`);

    const parsed = parseGvizResponse(await response.text());
    const row = parsed?.table?.rows?.[0]?.c || [];
    const subjects = Array.from({ length: 7 }, (_, index) => cellValue(row[index]));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ subjects });
  } catch (error) {
    res.status(502).json({ error: error.message || "Failed to load today schedule" });
  }
};
