import type { HTMLAttributes, ReactNode } from 'react';

type AppCardProps = HTMLAttributes<HTMLDivElement> & {
  className?: string;
  children: ReactNode;
};

export default function AppCard({ className = '', children, ...rest }: AppCardProps) {
  const base =
    'bg-white rounded-2xl border border-gray-200/70 shadow-[0_12px_30px_rgba(0,0,0,0.12)]';

  return (
    <div className={`${base} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}