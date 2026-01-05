import AppButton from '@/components/ui/AppButton';


type Props = {
  enabled: boolean;
  onReverse: () => void;
};

export default function RailwayDirectionReverseButton(props: Props) {
  const { enabled, onReverse } = props;

  return (
    <AppButton
      type="button"
      className={`px-2 py-1 text-xs rounded border ${
        enabled ? 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50' : 'opacity-50 cursor-not-allowed bg-white text-gray-800 border-gray-300'
      }`}
      disabled={!enabled}
      onClick={onReverse}
      title="方向反转"
    >
      方向反转
    </AppButton>
  );
}