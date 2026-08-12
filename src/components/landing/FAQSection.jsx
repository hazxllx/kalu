import React, { useState } from "react";
import { Minus, Plus, Mail, Phone } from "lucide-react";
import { SectionHeading } from "@/components/landing/GovChrome";

const faqs = [
  {
    question: "Who may use KALUSAGAP?",
    answer:
      "Bona fide residents of the Municipality of Pili, together with barangay health workers, midwives, rural health unit personnel, municipal health officers, and system administrators. Residents transferring from another barangay or municipality may also enrol.",
  },
  {
    question: "Is there a fee for registration?",
    answer:
      "No. Registration and all frontline services listed in this portal are provided free of charge. No representative of this office is authorised to collect payment for enrolment.",
  },
  {
    question: "How is my personal and health information protected?",
    answer:
      "Records are processed in accordance with the Data Privacy Act of 2012 (R.A. 10173). Access is limited to authorised health personnel assigned to your barangay, and every record access is logged in the system audit trail.",
  },
  {
    question: "How long does account verification take?",
    answer:
      "Your assigned Barangay Health Worker reviews submitted documents within two to three working days. You may log in with limited access while your account is under review.",
  },
  {
    question: "What should I do if I cannot access my account?",
    answer:
      "Approach your Barangay Health Worker or contact the Municipal Health Office through the hotline listed below. Bring a valid government-issued identification card for verification.",
  },
];

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section id="faq" className="border-t border-brand-border bg-white py-20 md:py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <SectionHeading
              kicker="Citizen's Inquiries"
              title="Frequently asked questions"
              lede="Answers to the questions most often raised at the Municipal Health Office public assistance desk."
            />

            <div className="gov-sheet mt-9 bg-brand-paper p-6">
              <p className="gov-kicker text-brand-blue">Public Assistance Desk</p>
              <ul className="mt-4 space-y-3">
                <li className="flex items-center gap-2.5 text-[13px] text-brand-ink">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
                  (054) 477-1234
                </li>
                <li className="flex items-center gap-2.5 text-[13px] text-brand-ink">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
                  health@pili.gov.ph
                </li>
              </ul>
              <p className="mt-4 border-t border-brand-border pt-3.5 text-[11.5px] uppercase tracking-[0.12em] text-brand-gray">
                Mon – Fri · 8:00 AM – 5:00 PM
              </p>
            </div>
          </div>

          <div className="border-t border-brand-border">
            {faqs.map((item, index) => {
              const isOpen = openIndex === index;
              return (
                <div key={item.question} className="border-b border-brand-border">
                  <h3>
                    <button
                      type="button"
                      onClick={() => setOpenIndex(isOpen ? -1 : index)}
                      aria-expanded={isOpen}
                      className="group flex w-full items-start gap-5 py-6 text-left"
                    >
                      <span className="mt-0.5 font-stat text-[11px] font-bold tracking-[0.12em] text-brand-gray/70">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`flex-1 text-[15.5px] font-semibold leading-snug transition-colors ${
                          isOpen ? "text-brand-blue" : "text-brand-ink group-hover:text-brand-blue"
                        }`}
                      >
                        {item.question}
                      </span>
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border transition-colors ${
                          isOpen
                            ? "border-brand-blue bg-brand-blue text-white"
                            : "border-brand-rule text-brand-gray group-hover:border-brand-blue group-hover:text-brand-blue"
                        }`}
                      >
                        {isOpen ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  </h3>
                  {isOpen && (
                    <div className="pb-6 pl-[46px] pr-11">
                      <p className="border-l-2 border-brand-blue/25 pl-5 text-[13.5px] leading-[1.8] text-brand-gray">
                        {item.answer}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
