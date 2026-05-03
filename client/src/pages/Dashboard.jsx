import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Video, Keyboard, Plus, LogOut, Clock, Calendar, 
  Share2, History, ChevronRight, Copy, Check, X, Link as LinkIcon 
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { SERVER_URL } from '../config';
import useAuthStore from '../store/useAuthStore';
import useMeetingStore from '../store/useMeetingStore';

export default function Dashboard() {
  const [meetingCode, setMeetingCode] = useState('');
  const [history, setHistory] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showNewMeetingMenu, setShowNewMeetingMenu] = useState(false);
  const [showLaterModal, setShowLaterModal] = useState(false);
  const [laterLink, setLaterLink] = useState('');
  const [copied, setCopied] = useState(false);
  
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { setHostStatus } = useMeetingStore();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    fetchHistory();
    return () => clearInterval(timer);
  }, [user]);

  const fetchHistory = async () => {
    if (!navigator.onLine) return;
    try {
      if (!user?._id) return;
      const token = localStorage.getItem('token');
      const res = await axios.get(`${SERVER_URL}/api/meetings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setHistory(res.data);
    } catch (err) {
      console.log("API ERROR:", err.message);
    }
  };

  const createForLater = async () => {
    const meetingId = uuidv4();
    const link = `${window.location.origin}/meeting/${meetingId}`;
    setLaterLink(link);
    setShowLaterModal(true);
    setShowNewMeetingMenu(false);
    
    if (!navigator.onLine) {
      alert("No internet connection");
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${SERVER_URL}/api/meetings`, { meetingId }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.log("API ERROR:", err.message);
    }
  };

  const startInstantMeeting = async () => {
    const meetingId = uuidv4();
    console.log('[Dashboard] Starting instant meeting:', meetingId);
    
    if (!navigator.onLine) {
      alert("No internet connection");
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${SERVER_URL}/api/meetings`, { meetingId }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setHostStatus(true);
      navigate(`/meeting/${meetingId}`);
    } catch (err) {
      console.log("API ERROR:", err.message);
      navigate(`/meeting/${meetingId}`); // Fallback
    }
  };

  const scheduleInCalendar = () => {
    const meetingId = uuidv4();
    const link = `${window.location.origin}/meeting/${meetingId}`;
    
    // Format: YYYYMMDDTHHmmSSZ
    const now = new Date();
    const start = now.toISOString().replace(/-|:|\.\d\d\d/g, "");
    const end = new Date(now.getTime() + 60 * 60 * 1000).toISOString().replace(/-|:|\.\d\d\d/g, "");
    
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=SmartMeet+Video+Conference&dates=${start}/${end}&details=Join+the+meeting+here:+${encodeURIComponent(link)}&location=Online&sf=true&output=xml`;
    
    window.open(calendarUrl, '_blank');
    setShowNewMeetingMenu(false);
  };

  const handleJoinMeeting = (e) => {
    e.preventDefault();
    let code = meetingCode.trim();
    if (code.includes('/')) code = code.split('/').pop();
    if (code) {
      setHostStatus(false);
      navigate(`/meeting/${code}`);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(laterLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#202124] text-white flex flex-col font-sans selection:bg-blue-500/30">
      {/* --- HEADER --- */}
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-600/20">
             <Video className="w-7 h-7 text-white" />
          </div>
          <span className="text-2xl font-semibold tracking-tight text-gray-100">SmartMeet</span>
        </div>
        
        <div className="flex items-center space-x-8">
          <div className="hidden lg:flex flex-col items-end text-gray-400">
             <span className="text-xl font-medium text-gray-200">
               {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
             </span>
             <span className="text-sm font-light mt-0.5 uppercase tracking-wide">
               {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
             </span>
          </div>
          
          <div className="flex items-center space-x-5">
             <div className="bg-[#3c4043] h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold border border-[#5f6368] shadow-sm">
               {user?.name?.charAt(0).toUpperCase()}
             </div>
             <button onClick={logout} className="p-3 hover:bg-white/10 rounded-full transition-all group" title="Logout">
               <LogOut size={20} className="text-gray-400 group-hover:text-red-400" />
             </button>
          </div>
        </div>
      </header>

      {/* --- MAIN HERO --- */}
      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center px-10 max-w-7xl mx-auto w-full gap-24 py-12 lg:py-0">
        
        {/* Actions Left */}
        <div className="flex-1 max-w-xl text-center lg:text-left">
          <h1 className="text-5xl lg:text-7xl font-bold leading-[1.1] mb-10 text-gray-50 tracking-tight">
            Premium video meetings.
          </h1>
          <p className="text-gray-400 text-xl mb-12 font-light leading-relaxed max-w-lg">
            Built for secure business meetings, SmartMeet is now available for everyone, anywhere.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-6 w-full lg:w-auto relative mb-16">
            <div className="relative w-full sm:w-auto">
              <button 
                onClick={() => setShowNewMeetingMenu(!showNewMeetingMenu)}
                className="flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-semibold transition-all shadow-xl shadow-blue-600/20 w-full sm:w-auto active:scale-95"
              >
                <Plus size={24} /> New meeting
              </button>
              
              {showNewMeetingMenu && (
                <div className="absolute top-full left-0 mt-4 w-72 bg-[#2d2e30] rounded-2xl shadow-2xl z-50 overflow-hidden border border-white/5 animate-in slide-in-from-top-2 duration-200">
                   <button onClick={createForLater} className="w-full text-left px-5 py-4 hover:bg-white/5 flex items-center gap-4 transition-all">
                     <LinkIcon size={18} className="text-blue-400" />
                     <span className="font-medium text-gray-200 text-sm">Create a meeting for later</span>
                   </button>
                   <button onClick={startInstantMeeting} className="w-full text-left px-5 py-4 hover:bg-white/5 flex items-center gap-4 transition-all border-t border-white/5">
                     <Plus size={18} className="text-blue-400" />
                     <span className="font-medium text-gray-200 text-sm">Start an instant meeting</span>
                   </button>
                   <button onClick={scheduleInCalendar} className="w-full text-left px-5 py-4 hover:bg-white/5 flex items-center gap-4 transition-all border-t border-white/5">
                     <Calendar size={18} className="text-blue-400" />
                     <span className="text-sm font-medium text-gray-200">Schedule in Google Calendar</span>
                   </button>
                </div>
              )}
            </div>
            
            <form onSubmit={handleJoinMeeting} className="flex items-center w-full sm:w-auto relative group">
              <div className="absolute left-4 text-gray-400 group-focus-within:text-blue-500 transition-colors">
                <Keyboard size={20} />
              </div>
              <input 
                type="text" 
                placeholder="Enter a code or link" 
                className="bg-[#2d2e30] border-2 border-transparent rounded-xl pl-12 pr-28 py-4 focus:border-blue-500 outline-none transition-all w-full sm:w-[320px] text-gray-200 shadow-sm"
                value={meetingCode}
                onChange={(e) => setMeetingCode(e.target.value)}
              />
              <button 
                type="submit" 
                disabled={!meetingCode}
                className="absolute right-3.5 text-blue-500 font-bold hover:text-blue-400 disabled:text-gray-600 transition-colors px-2 py-1 text-sm bg-blue-500/5 rounded"
              >
                Join
              </button>
            </form>
          </div>

          {/* History Section */}
          <div className="w-full h-px bg-white/5 mb-10" />
          <div className="flex flex-col gap-5">
             <h2 className="flex items-center gap-3 text-lg font-semibold text-gray-200">
               <History size={20} className="text-blue-500" /> Recent Sessions
             </h2>
             {history.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-4">
                   {history.slice(0, 4).map(meet => (
                      <div key={meet._id} className="p-4 bg-[#3c4043]/30 rounded-xl border border-white/5 hover:bg-[#3c4043]/50 transition-all cursor-pointer group flex items-center justify-between border-blue-500/0 hover:border-blue-500/20" onClick={() => navigate(`/meeting/${meet.meetingId}`)}>
                        <div className="overflow-hidden">
                           <p className="text-sm font-bold text-gray-200 truncate">{meet.meetingId}</p>
                           <p className="text-[11px] text-gray-500 uppercase mt-0.5">{new Date(meet.createdAt).toLocaleDateString()}</p>
                        </div>
                        <ChevronRight size={18} className="text-gray-600 group-hover:text-blue-400 transition-all" />
                      </div>
                   ))}
                </div>
             ) : (
                <p className="text-gray-500 italic text-sm text-left">No recent meetings found.</p>
             )}
          </div>
        </div>

        {/* Feature Illustrator Right */}
        <div className="flex-1 hidden lg:flex flex-col items-center justify-center p-10 bg-transparent">
           <img 
             src="/hero-illustration.jpg" 
             className="w-full max-w-[320px] mb-10 object-cover hover:scale-105 transition-transform duration-500" 
             alt="SmartMeet AI Assistant" 
           />
           <h3 className="text-2xl font-bold mb-4 text-gray-100 text-center">Your AI Assistant for Every Meeting</h3>
           <p className="text-gray-400 text-center max-w-xs leading-relaxed text-sm">
             SmartMeet brings powerful AI-driven engagement tracking right into your virtual boardroom.
           </p>
        </div>
      </main>

      {/* --- LATER MODAL --- */}
      {showLaterModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[100] p-4">
           <div className="bg-[#2d2e30] w-full max-w-md rounded-2xl shadow-2xl p-8 border border-white/5 animate-in zoom-in-95 duration-200 relative">
              <button 
                onClick={() => setShowLaterModal(false)}
                className="absolute top-4 right-4 text-[#9aa0a6] hover:text-white p-2"
              >
                <X size={20} />
              </button>
              <h3 className="text-xl font-medium mb-4 pr-10">Here's the link to your meeting</h3>
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                Copy this link and send it to people you want to meet with.
              </p>
              
              <div className="flex items-center gap-2 bg-[#202124] p-3 rounded-xl border border-white/5 mb-6 group">
                 <span className="text-sm text-gray-300 truncate flex-1">{laterLink}</span>
                 <button 
                   onClick={copyToClipboard}
                   className="p-2.5 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors shrink-0"
                   title="Copy meeting link"
                 >
                   {copied ? <Check size={20} /> : <Copy size={20} />}
                 </button>
              </div>

              <button 
                onClick={() => setShowLaterModal(false)}
                className="w-full py-3 bg-[#3c4043] hover:bg-[#4a4e51] rounded-xl font-semibold transition-all"
              >
                Done
              </button>
           </div>
        </div>
      )}
    </div>
  );
}
