import React from "react";
import { Link } from "react-router-dom";
import { Facebook, Mail, MapPin, Phone, Clock, ArrowUpRight } from "lucide-react";
import GovSeal from "@/components/branding/GovSeal";

const quickLinks = [
  { label: "Home", href: "#home" },
  { label: "About the System", href: "#about" },
  { label: "Health Services", href: "#services" },
  { label: "Health Programs", href: "#programs" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Frequently Asked Questions", href: "#faq" },
];

const govLinks = [
  { label: "Department of Health", href: "https://doh.gov.ph" },
  { label: "PhilHealth", href: "https://www.philhealth.gov.ph" },
  { label: "Official Gazette", href: "https://www.officialgazette.gov.ph" },
  { label: "GOV.PH", href: "https://www.gov.ph" },
];

export default function Footer() {
  return (
    <footer id="contact" className="bg-brand-deep text-white">
      <div className="h-[3px] w-full gov-flag-rule" aria-hidden="true" />

      <div className="gov-hatch-light">
        <div className="mx-auto max-w-content px-5 py-16 md:px-8">
          <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1.1fr]">
            {/* Agency identity */}
            <div>
              <div className="flex items-center gap-3.5">
                <GovSeal height={38} onDark className="shrink-0" />
                <div>
                  <p className="font-display text-[19px] font-bold leading-tight tracking-[0.03em] text-white">
                    KALUSAGAP
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-brand-goldlight">
                    Municipal Health Office
                  </p>
                </div>
              </div>
              <p className="mt-6 max-w-sm text-[13px] leading-[1.8] text-white/60">
                Community Health Risk Monitoring and Early Intervention System of
                the Municipality of Pili, Camarines Sur. Established to serve
                residents through accountable and accessible public health records.
              </p>
              <div className="mt-6 flex gap-2.5">
                <a
                  href="#"
                  aria-label="Facebook page"
                  className="flex h-9 w-9 items-center justify-center border border-white/20 text-white/70 transition-colors hover:border-brand-goldlight hover:text-brand-goldlight"
                >
                  <Facebook className="h-4 w-4" />
                </a>
                <a
                  href="mailto:health@pili.gov.ph"
                  aria-label="Send email"
                  className="flex h-9 w-9 items-center justify-center border border-white/20 text-white/70 transition-colors hover:border-brand-goldlight hover:text-brand-goldlight"
                >
                  <Mail className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* Quick links */}
            <nav>
              <h4 className="gov-kicker text-brand-goldlight">Portal</h4>
              <div className="mt-4 h-px w-8 bg-white/20" aria-hidden="true" />
              <ul className="mt-5 space-y-3">
                {quickLinks.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-[13px] text-white/65 transition-colors hover:text-white"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Government links */}
            <nav>
              <h4 className="gov-kicker text-brand-goldlight">Government</h4>
              <div className="mt-4 h-px w-8 bg-white/20" aria-hidden="true" />
              <ul className="mt-5 space-y-3">
                {govLinks.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="group inline-flex items-center gap-1.5 text-[13px] text-white/65 transition-colors hover:text-white"
                    >
                      {l.label}
                      <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Contact */}
            <div>
              <h4 className="gov-kicker text-brand-goldlight">Contact</h4>
              <div className="mt-4 h-px w-8 bg-white/20" aria-hidden="true" />
              <ul className="mt-5 space-y-4 text-[13px] text-white/65">
                <li className="flex gap-2.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-goldlight" strokeWidth={2} />
                  <span className="leading-relaxed">
                    Municipal Health Office
                    <br />
                    Municipal Hall Compound
                    <br />
                    Pili, Camarines Sur 4418
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-goldlight" strokeWidth={2} />
                  (054) 477-1234
                </li>
                <li className="flex gap-2.5">
                  <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-goldlight" strokeWidth={2} />
                  health@pili.gov.ph
                </li>
                <li className="flex gap-2.5">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-goldlight" strokeWidth={2} />
                  Mon – Fri · 8:00 AM – 5:00 PM
                </li>
              </ul>
            </div>
          </div>

          {/* Transparency strip */}
          <div className="mt-14 grid gap-6 border-t border-white/12 pt-8 sm:grid-cols-3">
            {[
              ["Data Privacy", "Records processed under R.A. 10173."],
              ["Universal Health Care", "Delivered under R.A. 11223."],
              ["Anti-Red Tape", "Service standards per R.A. 11032."],
            ].map(([title, copy]) => (
              <div key={title}>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/80">{title}</p>
                <p className="mt-1.5 text-[12px] text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/12 bg-black/25">
        <div className="mx-auto flex max-w-content flex-col gap-3 px-5 py-5 text-[11.5px] text-white/45 md:flex-row md:items-center md:justify-between md:px-8">
          <p>© {new Date().getFullYear()} Municipal Health Office of Pili. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link to="/login" className="transition-colors hover:text-white">
              Personnel Log In
            </Link>
            <a href="#faq" className="transition-colors hover:text-white">
              Privacy Notice
            </a>
            <a href="#faq" className="transition-colors hover:text-white">
              Terms of Use
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
