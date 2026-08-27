/**
 * MotionWrappers — Framer Motion components ใช้ซ้ำ
 *
 * ใช้สำหรับ:
 * - <FadeIn delay={n}>  — fade + slide up
 * - <Stagger> + <Stagger.Item> — list animation
 * - <Skeleton> — shimmer placeholder
 */
import { motion, type Variants } from 'framer-motion';
import { ReactNode, HTMLAttributes } from 'react';

/* ============== Variants (ใช้ซ้ำ) ============== */

export const fadeInUpVariants: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const scaleInVariants: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

export const slideInRightVariants: Variants = {
  initial: { opacity: 0, x: 30 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -30 },
};

export const staggerContainerVariants: Variants = {
  animate: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

export const staggerItemVariants: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

/* ============== Components ============== */

interface FadeInProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
  y?: number;
  as?: 'div' | 'span' | 'section' | 'article' | 'li';
}

export function FadeIn({
  children,
  delay = 0,
  duration = 0.4,
  className,
  y = 20,
  as = 'div',
}: FadeInProps) {
  const MotionTag = motion[as] as typeof motion.div;
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: 'easeOut' }}
    >
      {children}
    </MotionTag>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  delayChildren?: number;
}

export function Stagger({ children, className, delayChildren = 0.05 }: StaggerProps) {
  return (
    <motion.div
      className={className}
      initial="initial"
      animate="animate"
      variants={{
        animate: { transition: { staggerChildren: 0.06, delayChildren } },
      }}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'article';
}

export function StaggerItem({ children, className, as = 'div' }: StaggerItemProps) {
  const MotionTag = motion[as] as typeof motion.div;
  return (
    <MotionTag className={className} variants={staggerItemVariants}>
      {children}
    </MotionTag>
  );
}

/* ============== Tab transition ============== */

interface TabTransitionProps {
  tabId: string;
  children: ReactNode;
  className?: string;
}

export function TabTransition({ tabId, children, className }: TabTransitionProps) {
  return (
    <motion.div
      key={tabId}
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

/* ============== Skeleton (shimmer) ============== */

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'card' | 'circle' | 'block';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ variant = 'text', width, height, className = '', style, ...rest }: SkeletonProps) {
  const sizeStyle: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  const variantClass =
    variant === 'circle'
      ? 'rounded-full'
      : variant === 'card'
      ? 'rounded-lg'
      : variant === 'text'
      ? 'rounded h-3'
      : 'rounded-md';

  return (
    <div
      className={`skeleton ${variantClass} ${className}`}
      style={{ ...sizeStyle, ...style }}
      aria-busy="true"
      aria-live="polite"
      {...rest}
    />
  );
}

/* ============== Counter (นับเลข animation) ============== */

interface CountUpProps {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

import { useEffect, useState } from 'react';

export function CountUp({ value, duration = 0.6, className, prefix = '', suffix = '' }: CountUpProps) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const initial = display;
    const delta = value - initial;
    if (delta === 0) return;
    let raf: number;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(initial + delta * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className={className}>
      {prefix}
      {display.toLocaleString('th-TH')}
      {suffix}
    </span>
  );
}
