"""Audit the structure of the authoritative FHSIS XLSB workbook.

This intentionally records structure only. Cached barangay figures are not
copied into application data, fixtures, or defaults.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pyxlsb import open_workbook


STRUCTURAL_HEADERS = {
    "Indicators",
    "Age Group",
    "Sex",
    "Remarks",
    "Total",
    "TOTAL",
    "Male",
    "Female",
}


def audit_sheet(sheet):
    sections = []
    report_blocks = []
    labels = []
    header_rows = []

    for row_number, row in enumerate(sheet.rows(), start=1):
        values = [cell.v for cell in row]
        non_empty = [value for value in values if value not in (None, "")]
        if not non_empty:
            continue

        for value in non_empty:
            if isinstance(value, str) and value.startswith("SECTION "):
                sections.append({"row": row_number, "label": value.strip()})
            if isinstance(value, str) and value.startswith("FHSIS REPORT"):
                report_blocks.append({"row": row_number, "label": value.strip()})

        if any(value in STRUCTURAL_HEADERS for value in non_empty):
            header_rows.append(row_number)

        for column, value in enumerate(values, start=1):
            if column not in (1, 12) or not isinstance(value, str):
                continue
            label = " ".join(value.replace("\n", " ").split())
            if label and label not in STRUCTURAL_HEADERS and not label.startswith("SECTION "):
                labels.append({"row": row_number, "column": column, "label": label})

    return {
        "sections": sections,
        "reportBlocks": report_blocks,
        "headerRows": header_rows,
        "labelCount": len(labels),
        "labels": labels,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "workbook",
        nargs="?",
        default=Path(__file__).resolve().parents[2] / "FHSIS-Pili-I-2026.xlsb",
        type=Path,
    )
    args = parser.parse_args()

    with open_workbook(args.workbook) as workbook:
        sheets = {}
        for sheet_name in workbook.sheets:
            with workbook.get_sheet(sheet_name) as sheet:
                sheets[sheet_name] = audit_sheet(sheet)

    print(json.dumps({
        "workbook": str(args.workbook),
        "sheetCount": len(sheets),
        "sheets": sheets,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
