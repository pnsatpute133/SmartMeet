import { useRef, useEffect } from 'react';
import { MicOff, Mic, Shield } from 'lucide-react';

export default function VideoTile({ stream, name, isLocal, isMuted, isVideoOff, isHandRaised, isActiveSpeaker, isHost, isScreenSharing }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream || null;
    }
  }, [stream]);

  return (
    <div
      className={`
        relative group h-full min-h-[160px] bg-[#3c4043] rounded-2xl overflow-hidden aspect-video
        shadow-2xl transition-all duration-300 border-2
        ${isActiveSpeaker ? 'border-blue-500 ring-4 ring-blue-500/20' : 'border-transparent hover:border-white/10'}
      `}
    >
      {/* ── Audio element (Always mounted for remote users to ensure continuous sound) ── */}
      {!isLocal && stream && (
        <audio
          ref={(el) => {
            if (el) el.srcObject = stream;
          }}
          autoPlay
          playsInline
          muted={false}
          style={{ display: 'none' }}
        />
      )}

      {/* ── Video or Avatar ───────────────────────────────── */}
      {isVideoOff || !stream ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#202124] to-[#2d2e30]">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-800 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-xl border-2 border-blue-400/20">
            {name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <span className="mt-3 text-sm text-gray-400 max-w-[80%] truncate">{name}</span>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${
            isLocal && !isScreenSharing ? 'scale-x-[-1]' : ''
          }`}
        />
      )}

      {/* ── Bottom name bar ───────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2.5 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-2">
        {isMuted
          ? <MicOff size={14} className="text-red-400 shrink-0" />
          : <Mic    size={14} className="text-green-400 shrink-0" />
        }
        <span className="text-[13px] font-medium text-white truncate">{name}</span>
        {isHost && (
          <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-blue-300 font-semibold">
            <Shield size={10} /> Host
          </span>
        )}
      </div>

      {/* ── Hand raised ───────────────────────────────────── */}
      {isHandRaised && (
        <div className="absolute top-3 left-3 text-3xl animate-bounce drop-shadow-xl select-none">
          ✋
        </div>
      )}

      {/* ── Active speaker indicator ──────────────────────── */}
      {isActiveSpeaker && !isMuted && (
        <div className="absolute top-3 right-3">
          <div className="flex items-end gap-[3px] h-5">
            {[1, 2, 3, 2, 1].map((h, i) => (
              <div
                key={i}
                className="w-[3px] bg-blue-400 rounded-full animate-pulse"
                style={{ height: `${h * 5}px`, animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
