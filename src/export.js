import * as XLSX from "xlsx";

function buildRows(tracks, groups, genreMap, aiMap) {
  if (groups) {
    const rows = [];
    Object.entries(groups).forEach(([label, groupItems]) => {
      groupItems.forEach((item, i) => {
        const track = item.item;
        rows.push({
          Group: label,
          "#": i + 1,
          Title: track?.name ?? "",
          Artist: track?.artists?.[0]?.name ?? "",
          Year: track?.album?.release_date?.slice(0, 4) ?? "",
          Genre: aiMap[track?.id]?.genre ?? genreMap[track?.artists?.[0]?.id] ?? "",
        });
      });
    });
    return rows;
  }

  return tracks.map((item, i) => {
    const track = item.item;
    return {
      "#": i + 1,
      Title: track?.name ?? "",
      Artist: track?.artists?.[0]?.name ?? "",
      Year: track?.album?.release_date?.slice(0, 4) ?? "",
      Genre: aiMap[track?.id]?.genre ?? genreMap[track?.artists?.[0]?.id] ?? "",
    };
  });
}

function safeName(name) {
  return (name || "playlist").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
}

export function exportCSV(tracks, groups, genreMap, aiMap, name) {
  const rows = buildRows(tracks, groups, genreMap, aiMap);
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(name)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportExcel(tracks, groups, genreMap, aiMap, name) {
  const rows = buildRows(tracks, groups, genreMap, aiMap);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tracks");
  XLSX.writeFile(wb, `${safeName(name)}.xlsx`);
}
