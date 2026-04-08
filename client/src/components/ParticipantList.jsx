import { useState } from 'react';
import { Mic, MicOff, Monitor, X, Volume2 } from 'lucide-react';
import useMeetingStore from '../store/useMeetingStore';

export default function ParticipantList({ 
  onMuteUser, 
  onUnmuteUser, 
  onRemoveUser, 
  approveScreenShare,
  denyScreenShare,
}) {
  const { participants, isHost, screenShareRequest, localStatus } = useMeetingStore();
  const [expandedUser, setExpandedUser] = useState(null);

  if (!participants || participants.length === 0) {
    return (
      <div className="p-4 text-center text-gray-400">
        <p>No other participants</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-white">
          Participants ({participants.length + 1})
        </h2>
        {screenShareRequest && isHost && (
          <div className="mt-2 p-2 bg-blue-900 rounded text-sm text-blue-200">
            <p className="font-semibold">📺 {screenShareRequest.name}</p>
            <p className="text-xs mt-1">Requesting screen share</p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => approveScreenShare(screenShareRequest.userId)}
                className="flex-1 px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-semibold transition"
              >
                Allow
              </button>
              <button
                onClick={() => denyScreenShare(screenShareRequest.userId)}
                className="flex-1 px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-semibold transition"
              >
                Deny
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Participants List */}
      <div className="flex-1 overflow-y-auto">
        {/* Local User */}
        <div className="p-3 border-b border-gray-800 bg-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                YOU
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold text-sm">Your Video</p>
                <p className="text-gray-400 text-xs">
                  {localStatus.isMuted ? 'Muted' : 'Speaking'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {!localStatus.isMuted && <Mic className="w-4 h-4 text-green-500" />}
                {localStatus.isMuted && <MicOff className="w-4 h-4 text-red-500" />}
              </div>
            </div>
          </div>
        </div>

        {/* Remote Participants */}
        {participants.map(participant => (
          <ParticipantItem
            key={participant.socketId}
            participant={participant}
            isHost={isHost}
            isExpanded={expandedUser === participant.socketId}
            onExpand={() => setExpandedUser(
              expandedUser === participant.socketId ? null : participant.socketId
            )}
            onMute={() => onMuteUser(participant.socketId)}
            onUnmute={() => onUnmuteUser(participant.socketId)}
            onRemove={() => onRemoveUser(participant.socketId)}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantItem({
  participant,
  isHost,
  isExpanded,
  onExpand,
  onMute,
  onUnmute,
  onRemove,
}) {
  const { role, name, isMuted, isScreenSharing } = participant;

  return (
    <div className="p-3 border-b border-gray-800 hover:bg-gray-800 transition">
      <div
        onClick={onExpand}
        className="flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-3 flex-1">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-white font-semibold text-sm">{name}</p>
              {role === 'host' && (
                <span className="text-xs bg-amber-600 text-white px-2 py-0.5 rounded">
                  HOST
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {isMuted && <span>🔇 Muted</span>}
              {!isMuted && <span>🔊 Speaking</span>}
              {isScreenSharing && (
                <span className="flex items-center gap-1">
                  <Monitor className="w-3 h-3" /> Sharing
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Mic Status Icon */}
        <div className="ml-2">
          {!isMuted && <Mic className="w-4 h-4 text-green-500" />}
          {isMuted && <MicOff className="w-4 h-4 text-red-500" />}
        </div>
      </div>

      {/* Expanded Controls (Host Only) */}
      {isExpanded && isHost && (
        <div className="mt-3 pt-3 border-t border-gray-700 flex gap-2 flex-wrap">
          {!isMuted ? (
            <button
              onClick={onMute}
              className="flex-1 text-xs px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition flex items-center justify-center gap-1"
            >
              <MicOff className="w-3 h-3" /> Mute
            </button>
          ) : (
            <button
              onClick={onUnmute}
              className="flex-1 text-xs px-2 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded transition flex items-center justify-center gap-1"
            >
              <Mic className="w-3 h-3" /> Unmute
            </button>
          )}
          <button
            onClick={onRemove}
            className="flex-1 text-xs px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded transition flex items-center justify-center gap-1"
          >
            <X className="w-3 h-3" /> Remove
          </button>
        </div>
      )}
    </div>
  );
}
