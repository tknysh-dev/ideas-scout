"use client";

import { usePathname } from "next/navigation";
import { MotionConfig, motion } from "motion/react";
import { EASE } from "@/components/motion";

// reducedMotion="user" вимикає весь рух порталу (картки, таби, тултіпи) за
// системною налаштовкою користувача — одним місцем, а не по компоненту.
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// Ключ по маршруту: кожна сторінка з'являється проявленням, а не стрибком.
// Тільки opacity — рух по вертикалі лишається за картками всередині, інакше
// сторінка «дихає» двічі.
export default function PageShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.main
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="min-w-0 flex-1"
    >
      {children}
    </motion.main>
  );
}
