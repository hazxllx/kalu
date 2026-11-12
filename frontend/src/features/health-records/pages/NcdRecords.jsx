import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProgramFormPage from "../components/ProgramFormPage";
import TclPageHeader from "../components/TclPageHeader";
import { PROGRAM_FORMS } from "../lib/programFormConfig";
import TclTabs from "../components/TclTabs";

const TABS = [
  PROGRAM_FORMS["ncd-risk"],
  PROGRAM_FORMS["ncd-cervical"],
  PROGRAM_FORMS["ncd-visual"],
];

/**
 * Non-Communicable Disease (NCD) Target Client Lists. The official workbook has
 * three distinct worksheets, each implemented as its own form/table — they are
 * NOT interchangeable versions of one generic NCD form. The initial tab can be
 * preselected via ?tab= (used by the TCL workspace deep links).
 */
export default function NcdRecords() {
  const [params] = useSearchParams();
  const requested = params.get("tab");
  const initial = TABS.some((t) => t.kind === requested) ? requested : TABS[0].kind;
  const [active, setActive] = useState(initial);
  const config = TABS.find((t) => t.kind === active) || TABS[0];

  return (
    <>
      <TclPageHeader
        crumb="NCD"
        title="NCD Target Client Lists"
        subtitle="Risk-assessed adults, cervical cancer & breast mass examination, and visual acuity & PPV for senior citizens."
      />
      <TclTabs tabs={TABS.map((t) => ({ value: t.kind, label: t.label }))} active={active} onChange={setActive} label="NCD sections" />
      <ProgramFormPage key={config.kind} config={config} />
    </>
  );
}
