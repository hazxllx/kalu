import React from "react";

/**
 * FHSIS Monthly Form M1 — official-style PRINT DOCUMENT (LANDSCAPE).
 *
 * Presentation-only. Renders the COMPLETE M1 report (Sections A–H, every
 * indicator, including zeros) as a dense, spreadsheet-like government form on
 * A4 LANDSCAPE, using the client's FHSIS form organization:
 *
 *   - compact formal identification header (bordered grid, no cards);
 *   - dark-blue full-width SECTION bars and compact subsection bars;
 *   - INDICATOR-SPECIFIC tables: the columns follow each indicator group's real
 *     breakdowns. Age schemes become actual "Age Group" columns, sex-disaggregated
 *     indicators get actual Male / Female columns, every table keeps Total and
 *     Remarks, and every cell is a real, visible grid cell.
 *   - related compact indicator blocks are placed SIDE-BY-SIDE to use the
 *     landscape width, so several sections/subsections share a page.
 *
 * All numbers come from the existing M1 report (`/m1/monthly` indicators). This
 * component performs no calculation and invents nothing: it only lays the real
 * `total`, `byAge` and `bySex` breakdowns into the form's cells. Age and sex are
 * shown as the SEPARATE breakdowns the data actually provides (it is not a
 * cross-tabulation), so no cell is fabricated.
 *
 * The same component renders the on-screen preview and the printed/PDF copy.
 *
 * Print behaviour: A4 landscape @page, controlled breaks — subsection tables
 * either stay whole (compact) or flow with their <thead> repeated (long), rows
 * never split, section bars never end a page alone, and paired blocks stay
 * together.
 */

const CSS = `
.m1doc {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  background: #ffffff;
  color: #12263F;
  font-family: Arial, "Helvetica Neue", Helvetica, "Segoe UI", sans-serif;
  font-size: 9.5px;
  line-height: 1.2;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.m1doc * { box-sizing: border-box; }

/* ---------- identification header ---------- */
.m1doc .m1-head { text-align: center; margin: 0 0 4px; }
.m1doc .m1-title {
  margin: 0; font-size: 14px; font-weight: 700;
  letter-spacing: .3px; text-transform: uppercase; color: #072F5F;
}
.m1doc .m1-subtitle { margin: 1px 0 0; font-size: 10px; font-weight: 600; color: #12263F; }

.m1doc .m1-info { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 5px; }
.m1doc .m1-info th,
.m1doc .m1-info td {
  border: 1px solid #9AA8B8; padding: 2px 4px; font-size: 8.8px;
  vertical-align: middle; text-align: left; overflow-wrap: anywhere;
}
.m1doc .m1-info th { width: 12%; background: #EEF3F9; color: #0B4A8F; font-weight: 700; }
.m1doc .m1-info td { width: 21.33%; }

/* ---------- section bars ---------- */
.m1doc .m1-section {
  margin: 0 0 5px;
  break-inside: avoid; page-break-inside: avoid;
  break-after: avoid; page-break-after: avoid;
}
.m1doc .m1-section-head {
  background: #0B4A8F; color: #ffffff; font-size: 10.5px; font-weight: 700;
  letter-spacing: .4px; padding: 2.5px 6px;
  break-after: avoid; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid;
}

/* ---------- indicator tables ---------- */
.m1doc .m1-block {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 0 0 4px;
  break-inside: avoid; page-break-inside: avoid;
}
.m1doc .m1-block thead { display: table-header-group; }
.m1doc .m1-block.keep { break-inside: avoid; page-break-inside: avoid; }
.m1doc .m1-block.flow { break-inside: avoid; page-break-inside: avoid; }
.m1doc .m1-block th,
.m1doc .m1-block td {
  border: 1px solid #9AA8B8;
  padding: 2px 4px;
  font-size: 8.8px;
  line-height: 1.2;
  vertical-align: middle;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.m1doc .m1-sub-head th {
  background: #DCE6F2; color: #0B4A8F; font-size: 9px; font-weight: 700;
  text-align: left; padding: 2px 6px;
  break-after: avoid; page-break-after: avoid;
}
.m1doc .m1-band th { background: #C7D6E8; color: #0B4A8F; font-size: 8.4px; font-weight: 700; text-align: center; padding: 2px 3px; }
.m1doc .m1-col-head th { background: #EEF3F9; color: #334155; font-size: 8.4px; font-weight: 700; text-align: center; padding: 2px 3px; }
.m1doc .m1-band th.m1-c-ind, .m1doc .m1-col-head th.m1-c-ind { text-align: left; }
.m1doc .m1-row { break-inside: avoid; page-break-inside: avoid; }
.m1doc .m1-row td { font-size: 8.8px; }
.m1doc .m1-c-code { text-align: center; white-space: nowrap; font-family: "Courier New", ui-monospace, monospace; font-size: 8.4px; color: #334155; }
.m1doc .m1-c-num { text-align: center; font-variant-numeric: tabular-nums; }
.m1doc .m1-c-total { text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.m1doc .m1-c-rem { font-size: 8.2px; color: #475569; }

/* ---------- side-by-side blocks ---------- */
.m1doc .m1-split {
  width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed;
  break-inside: avoid; page-break-inside: avoid; margin: 0 0 4px;
}
.m1doc .m1-split-cell { vertical-align: top; padding: 0; }
.m1doc .m1-split-cell:first-child { padding-right: 2px; }
.m1doc .m1-split-cell:last-child { padding-left: 2px; }
.m1doc .m1-split .m1-block { margin-bottom: 0; }

.m1doc .m1-empty { padding: 16px; text-align: center; font-size: 11px; color: #64748B; }

@media print {
  .m1doc { width: 100% !important; }
  .m1doc .m1-block,
  .m1doc .m1-info,
  .m1doc .m1-split { page-break-inside: avoid; }
}
@page { size: A4 landscape; margin: 8mm 10mm; }
`;

const hasSex = (it) => Boolean(it?.sexBreakdown && it?.bySex);

/** Age bands become real columns only when the indicator actually has >1 band. */
const ageColsOf = (it) => (Array.isArray(it?.ageGroups) && it.ageGroups.length > 1 ? it.ageGroups : []);

const colCount = (ageCols, sex) => 2 + ageCols.length + (sex ? 2 : 0) + 2; // code, indicator, ages, sex(M/F), total, remarks

/** Proportional column widths; Indicator stays the widest. */
const colWidths = (ageCols, sex) => {
  const w = [7, 34, ...ageCols.map(() => 8)];
  if (sex) w.push(7, 7);
  w.push(8, 20);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => `${((x / sum) * 100).toFixed(3)}%`);
};

/** Split one subsection into consecutive indicator groups sharing a column signature. */
const splitBlocks = (subsection, items) => {
  const blocks = [];
  let cur = null;
  for (const it of items) {
    const ageCols = ageColsOf(it);
    const sex = hasSex(it);
    const sig = `${ageCols.join("|")}#${sex}`;
    if (!cur || cur.sig !== sig) {
      cur = { subsection, sig, ageCols, sex, items: [] };
      blocks.push(cur);
    }
    cur.items.push(it);
  }
  return blocks;
};

const isPairable = (b) => b.items.length <= 5 && colCount(b.ageCols, b.sex) <= 8;

const EXPLICIT_LATERAL_PAIRS = {
  C: [["C2b. Child Nutritional Status", "C3. Deworming Services (Children/Adolescents)"]],
  E: [["E5. Tuberculosis", "E6. Malaria"], ["E7. Leprosy", "E8. Rabies"]],
};

const sectionRows = (section, subsections) => {
  const rows = [];
  const used = new Set();
  const pairings = EXPLICIT_LATERAL_PAIRS[section] || [];

  for (const names of pairings) {
    const blocks = [];
    for (const name of names) {
      const match = subsections.find((sub) => sub.subsection === name);
      if (!match) continue;
      used.add(name);
      blocks.push(...splitBlocks(match.subsection, match.items));
    }
    if (blocks.length) rows.push(blocks);
  }

  for (const sub of subsections) {
    if (used.has(sub.subsection)) continue;
    rows.push(splitBlocks(sub.subsection, sub.items));
  }

  return rows;
};

function BlockTable({ block }) {
  const { subsection, ageCols, sex, items } = block;
  const cols = colCount(ageCols, sex);
  const widths = colWidths(ageCols, sex);
  const twoRow = ageCols.length > 0 || sex;
  const long = items.length >= 9;

  return (
    <table className={`m1-block ${long ? "flow" : "keep"}`}>
      <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        <tr className="m1-sub-head">
          <th colSpan={cols}>{subsection}</th>
        </tr>
        {twoRow ? (
          <>
            <tr className="m1-band">
              <th rowSpan={2}>Code</th>
              <th rowSpan={2} className="m1-c-ind">Indicator</th>
              {ageCols.length ? <th colSpan={ageCols.length}>Age Group</th> : null}
              {sex ? <th colSpan={2}>Sex</th> : null}
              <th rowSpan={2}>Total</th>
              <th rowSpan={2}>Remarks</th>
            </tr>
            <tr className="m1-col-head">
              {ageCols.map((a) => <th key={a}>{a}</th>)}
              {sex ? [<th key="m">Male</th>, <th key="f">Female</th>] : null}
            </tr>
          </>
        ) : (
          <tr className="m1-col-head">
            <th>Code</th>
            <th className="m1-c-ind">Indicator</th>
            <th>Total</th>
            <th>Remarks</th>
          </tr>
        )}
      </thead>
      <tbody>
        {items.map((it) => (
          <tr className="m1-row" key={it.code}>
            <td className="m1-c-code">{it.code}</td>
            <td>{it.name}</td>
            {ageCols.map((a) => <td className="m1-c-num" key={a}>{it.byAge?.[a] ?? 0}</td>)}
            {sex ? (
              <>
                <td className="m1-c-num">{it.bySex?.Male ?? 0}</td>
                <td className="m1-c-num">{it.bySex?.Female ?? 0}</td>
              </>
            ) : null}
            <td className="m1-c-total">{it.total ?? 0}</td>
            <td className="m1-c-rem">{it.remarks || ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InfoRow({ cells }) {
  return (
    <tr>
      {cells.map(([label, value]) => (
        <React.Fragment key={label}>
          <th scope="row">{label}</th>
          <td>{value === null || value === undefined || value === "" ? "" : value}</td>
        </React.Fragment>
      ))}
    </tr>
  );
}

export default function M1PrintDocument({ groups = [], meta, periodLabel, barangay, branding = null }) {
  const facility = meta?.meta?.bhs_name || meta?.barangay?.healthStation || "";
  const brgy = meta?.barangay?.name || barangay || "";

  return (
    <div className="m1doc">
      <style>{CSS}</style>

      <div className="m1-head">
        <div className="mb-1 flex items-center justify-center gap-2">
          {branding?.logos?.municipal?.dataUrl && <img src={branding.logos.municipal.dataUrl} alt="Municipality of Pili official logo" className="h-8 max-w-12 object-contain" />}
          {branding?.logos?.rhu?.dataUrl && <img src={branding.logos.rhu.dataUrl} alt="Rural Health Unit official logo" className="h-8 max-w-12 object-contain" />}
        </div>
        <p className="m1-title">FHSIS — MONTHLY FORM M1</p>
        <p className="m1-subtitle">Program Accomplishment / Service Coverage Report</p>
      </div>

      <table className="m1-info">
        <tbody>
          <InfoRow cells={[
            ["Reporting Period", periodLabel],
            ["Barangay", brgy],
            ["BHS / Facility", facility],
          ]} />
          <InfoRow cells={[
            ["Municipality/City", meta?.municipality || ""],
            ["Province", meta?.province || ""],
            ["Projected Population", meta?.meta?.projected_population],
          ]} />
          <InfoRow cells={[
            ["Prepared by", meta?.meta?.prepared_by || ""],
            ["Designation", meta?.meta?.designation || ""],
            ["Validated by", meta?.meta?.validated_by || ""],
          ]} />
        </tbody>
      </table>

      {!groups.length ? (
        <p className="m1-empty">No M1 indicators available for this reporting period.</p>
      ) : (
        groups.map((g) => {
          const rows = sectionRows(g.section, g.subsections);

          return (
            <section className="m1-section" key={g.section}>
              <div className="m1-section-head">SECTION {g.section} — {g.title}</div>
              {rows.map((pair, ri) => {
                const cells = Array.isArray(pair) ? pair : [pair];
                const first = cells[0];

                if (cells.length >= 2) {
                  return (
                    <table className="m1-split" key={`${g.section}-r${ri}`}>
                      <tbody>
                        <tr>
                          <td className="m1-split-cell"><BlockTable block={cells[0]} /></td>
                          <td className="m1-split-cell"><BlockTable block={cells[1]} /></td>
                        </tr>
                      </tbody>
                    </table>
                  );
                }

                return <BlockTable block={first} key={`${g.section}-r${ri}`} />;
              })}
            </section>
          );
        })
      )}
    </div>
  );
}
