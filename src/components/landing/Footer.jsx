import React from "react";
import { Facebook, Mail, MapPin, Phone } from "lucide-react";
import { LOGO_URL } from "@/lib/brand";

export default function Footer() {
  return (
    <footer id="contact" className="bg-brand-dark text-white/80">
      <div className="max-w-content mx-auto px-5 md:px-8 py-16 grid md:grid-cols-4 gap-10">
        <div className="md:col-span-1">
          <div className="bg-white rounded-xl p-3 inline-block"><img src={LOGO_URL} alt="KALUSAGAP" className="h-8 w-auto" /></div>
          <p className="mt-4 text-sm leading-relaxed">Community Health Risk Monitoring and Early Intervention System. Healthcare for every community.</p>
        </div>
        <div>
          <h4 className="text-white font-semibold mb-4">Quick Links</h4>
          <ul className="space-y-2.5 text-sm">
            <li><a href="#home" className="hover:text-white transition-colors">Home</a></li>
            <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
            <li><a href="#services" className="hover:text-white transition-colors">Health Services</a></li>
            <li><a href="#about" className="hover:text-white transition-colors">About</a></li>
          </ul>
        </div>
        <div>
          <h4 className="text-white font-semibold mb-4">Legal</h4>
          <ul className="space-y-2.5 text-sm">
            <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
            <li><a href="#contact" className="hover:text-white transition-colors">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 className="text-white font-semibold mb-4">Contact</h4>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-2.5"><MapPin className="w-4 h-4 shrink-0 mt-0.5" /> Municipality of Pili, Camarines Sur</li>
            <li className="flex gap-2.5"><Phone className="w-4 h-4 shrink-0 mt-0.5" /> (054) 477-1234</li>
            <li className="flex gap-2.5"><Mail className="w-4 h-4 shrink-0 mt-0.5" /> health@pili.gov.ph</li>
          </ul>
          <a href="#" className="mt-4 inline-flex items-center gap-2 text-sm hover:text-white"><Facebook className="w-4 h-4" /> Facebook</a>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-content mx-auto px-5 md:px-8 py-5 flex flex-col sm:flex-row justify-between gap-2 text-xs text-white/60">
          <p>© 2026 KALUSAGAP — Municipality of Pili. All rights reserved.</p>
          <p>Healthcare for Every Community</p>
        </div>
      </div>
    </footer>
  );
}