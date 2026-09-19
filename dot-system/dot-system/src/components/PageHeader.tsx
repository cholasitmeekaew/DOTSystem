import { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface PageHeaderProps {
  icon: ReactNode;
  kicker?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ icon, kicker = 'BIT CITIES • DOT SYSTEM', title, subtitle, actions }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="page-header mb-6"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4 min-w-0">
          {/* icon badge */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 18 }}
            className="ph-icon-badge flex-shrink-0"
          >
            {icon}
          </motion.div>

          <div className="min-w-0 pt-0.5">
            {/* kicker */}
            <div className="text-[10px] font-semibold tracking-[0.25em] text-amber-500/80 uppercase mb-1">
              {kicker}
            </div>
            {/* title */}
            <h1 className="text-2xl font-black text-white tracking-tight leading-tight">{title}</h1>
            {/* subtitle */}
            {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
            <div className="ph-accent-line mt-3" aria-hidden />
          </div>
        </div>

        {actions && (
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.35 }}
            className="flex items-center gap-2 flex-shrink-0"
          >
            {actions}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
