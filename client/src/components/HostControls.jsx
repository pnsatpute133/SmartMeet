import { AlertCircle, LogOut } from 'lucide-react';
import useMeetingStore from '../store/useMeetingStore';

export default function HostControls({ onEndMeeting, onMuteAll, onOpen }) {
  const { isHost } = useMeetingStore();

  if (!isHost) return null;

  return (
    <div className="p-4 border-t border-gray-700 bg-gray-800">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-amber-500" />
        Host Controls
      </h3>
      <div className="flex flex-col gap-2">
        <button
          onClick={onMuteAll}
          className="w-full px-3 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded transition"
        >
          🔇 Mute All Participants
        </button>
        <button
          onClick={onEndMeeting}
          className="w-full px-3 py-2 text-sm font-semibold bg-red-700 hover:bg-red-800 text-white rounded transition flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          End Meeting for All
        </button>
      </div>
    </div>
  );
}
