/**
 * PageTransition — wrap page เพื่อมี enter/exit animation
 */
import { motion, AnimatePresence } from 'framer-motion';
import { ReactNode } from 'react';
import { useLocation } from 'wouter';

interface Props {
  children: ReactNode;
}

export function PageTransition({ children }: Props) {
  const [location] = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
