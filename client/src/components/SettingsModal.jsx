import { useState, useEffect, useRef } from 'react';
import { X, Camera, Mic, Volume2, ChevronDown, Check } from 'lucide-react';

export default function SettingsModal({ onClose, localStream, onSwitchDevice }) {
  const [devices, setDevices]         = useState({ audioinput: [], videoinput: [], audiooutput: [] });
  const [selected, setSelected]       = useState({ audioinput: '', videoinput: '', audiooutput: '' });
  const [activeTab, setActiveTab]     = useState('video'); // 'video' | 'audio'
  const [videoPreview, setVideoPreview] = useState(null);
  const previewRef = useRef(null);

  // Load devices
  useEffect(() => {
    async function loadDevices() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const grouped = { audioinput: [], videoinput: [], audiooutput: [] };
        list.forEach(d => { if (grouped[d.kind]) grouped[d.kind].push(d); });
        setDevices(grouped);
      } catch (err) {
        console.error('Could not enumerate devices:', err);
      }
    }
    loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, []);

  // Preview local video
  useEffect(() => {
    if (previewRef.current && localStream) {
      previewRef.current.srcObject = localStream;
    }
  }, [localStream, activeTab]);

  // Get currently active device IDs from stream
  useEffect(() => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];
    setSelected(prev => ({
      ...prev,
      videoinput: videoTrack?.getSettings()?.deviceId || '',
      audioinput: audioTrack?.getSettings()?.deviceId || '',
    }));
  }, [localStream]);

  const handleSwitch = async (kind, deviceId) => {
    setSelected(prev => ({ ...prev, [kind]: deviceId }));
    if (onSwitchDevice) await onSwitchDevice(kind, deviceId);
  };

  const tabs = [
    { id: 'video', icon: Camera,   label: 'Camera' },
    { id: 'audio', icon: Mic,      label: 'Audio' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
      <div className="bg-[#2d2e30] w-full max-w-lg rounded-2xl shadow-2xl border border-white/10 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-medium text-gray-100">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex">
          {/* Sidebar tabs */}
          <div className="w-36 border-r border-white/10 py-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-all ${
                  activeTab === tab.id
                    ? 'text-blue-400 bg-blue-500/10 font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <tab.icon size={17} /> {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6">

            {activeTab === 'video' && (
              <div className="space-y-5">
                {/* Preview */}
                <div className="bg-black rounded-xl overflow-hidden aspect-video relative">
                  <video
                    ref={previewRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute inset-0 pointer-events-none border border-white/5 rounded-xl" />
                </div>

                {/* Camera selector */}
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Camera</label>
                  <DeviceSelect
                    devices={devices.videoinput}
                    selected={selected.videoinput}
                    onChange={id => handleSwitch('videoinput', id)}
                  />
                </div>
              </div>
            )}

            {activeTab === 'audio' && (
              <div className="space-y-5">
                {/* Mic selector */}
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block flex items-center gap-2">
                    <Mic size={13} /> Microphone
                  </label>
                  <DeviceSelect
                    devices={devices.audioinput}
                    selected={selected.audioinput}
                    onChange={id => handleSwitch('audioinput', id)}
                  />
                </div>

                {/* Output selector (display only if supported) */}
                {devices.audiooutput.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block flex items-center gap-2">
                      <Volume2 size={13} /> Speakers
                    </label>
                    <DeviceSelect
                      devices={devices.audiooutput}
                      selected={selected.audiooutput}
                      onChange={id => setSelected(prev => ({ ...prev, audiooutput: id }))}
                    />
                  </div>
                )}

                <p className="text-xs text-gray-500 leading-relaxed mt-3">
                  Switching microphone will take effect immediately for all peers.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small select component ─────────────────────────────────────
function DeviceSelect({ devices, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const selectedDevice  = devices.find(d => d.deviceId === selected) || devices[0];
  const ref             = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (devices.length === 0) {
    return <p className="text-sm text-gray-500 italic">No devices found</p>;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 bg-[#202124] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 hover:border-blue-500/50 transition-all"
      >
        <span className="truncate">{selectedDevice?.label || `Device ${devices[0]?.deviceId?.slice(0, 8)}`}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#3c4043] border border-white/10 rounded-xl shadow-xl z-10 overflow-hidden max-h-48 overflow-y-auto">
          {devices.map(d => (
            <button
              key={d.deviceId}
              onClick={() => { onChange(d.deviceId); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm text-gray-200 transition-all text-left"
            >
              {d.deviceId === selected && <Check size={14} className="text-blue-400 shrink-0" />}
              <span className={`truncate ${d.deviceId === selected ? 'text-blue-300' : ''}`}>
                {d.label || `Device ${d.deviceId.slice(0, 8)}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
