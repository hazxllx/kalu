import React from "react";
import Navbar from "@/features/landing/components/Navbar";
import Hero from "@/features/landing/components/Hero";
import ServicesSection from "@/features/landing/components/ServicesSection";
import Features from "@/features/landing/components/Features";
import About from "@/features/landing/components/About";
import HowItWorks from "@/features/landing/components/HowItWorks";
import FamilyCareSection from "@/features/landing/components/FamilyCareSection";
import FAQSection from "@/features/landing/components/FAQSection";
import CTASection from "@/features/landing/components/CTASection";
import Footer from "@/features/landing/components/Footer";

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
