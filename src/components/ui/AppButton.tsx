import { forwardRef, type ButtonHTMLAttributes } from 'react';

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
};

const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(
  ({ className = '', type = 'button', ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed !rounded-2xl';

    return (
      <button
        ref={ref}
        type={type}
        className={`${base} ${className}`.trim()}
        {...props}
      />
    );
  }
);

AppButton.displayName = 'AppButton';

export default AppButton;