"use client";

import { motion, type HTMLMotionProps } from "motion/react";

// Одна крива на весь портал: рух має читатись як одна система, а не як набір
// різних анімацій на кожному екрані.
export const EASE = [0.22, 0.61, 0.36, 1] as const;
export const DURATION = 0.28;

export const FADE_UP = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

type Tag = "div" | "li" | "section" | "tr";

// Поява блоку знизу вгору. `index` дає сходинку в списках; стелю тримаємо на
// восьмому елементі, інакше довгий список докручується до анімації в секунду.
export function Reveal({
  as = "div",
  index = 0,
  className,
  children,
  ...rest
}: {
  as?: Tag;
  index?: number;
  className?: string;
  children: React.ReactNode;
} & Omit<HTMLMotionProps<"div">, "children" | "className">) {
  const Component = motion[as] as typeof motion.div;
  return (
    <Component
      initial={FADE_UP.initial}
      animate={FADE_UP.animate}
      transition={{ duration: DURATION, ease: EASE, delay: Math.min(index, 8) * 0.035 }}
      className={className}
      {...rest}
    >
      {children}
    </Component>
  );
}
