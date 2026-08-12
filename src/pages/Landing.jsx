import React from "react";
import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import ServicesSection from "@/components/landing/ServicesSection";
import Features from "@/components/landing/Features";
import About from "@/components/landing/About";
import HowItWorks from "@/components/landing/HowItWorks";
import FamilyCareSection from "@/components/landing/FamilyCareSection";
import FAQSection from "@/components/landing/FAQSection";
import CTASection from "@/components/landing/CTASection";
import Footer from "@/components/landing/Footer";

export default function Landing() {
  return (
    <div className="overflow-x-hidden bg-white text-brand-ink">
      <Navbar />
      <main>
        <Hero />
        <ServicesSection />
        <About />
        <Features />
        <HowItWorks />
        <FamilyCareSection />
        <FAQSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
