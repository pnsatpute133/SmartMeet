import { useState, useRef, useEffect } from 'react';
import { Send, X, Download, Info } from 'lucide-react';

export default function ChatPanel({ messages, onSendMessage, onClose, currentUserId }) {
  const [text, setText] = useState('');
  const scrollRef = useRef();
  const inputRef = useRef();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (text.trim()) {
      onSendMessage(text.trim());
      setText('');
    }
  };

  const handleKeyDown = (e) => {
    // Allow Enter to submit, Shift+Enter for newline-like behavior
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const downloadCSV = () => {
    try {
      const headers = ["Sender", "Message", "Time"];
      const rows = messages.map(m => [
        m.senderName, 
        (m.content || m.text || "").replace(/"/g, '""'), 
        new Date(m.timestamp).toLocaleString()
      ]);
      
      let csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n"
        + rows.map(e => `"${e[0]}","${e[1]}","${e[2]}"`).join("\n");
        
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `SmartMeet_Chat_${new Date().getTime()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  // Group consecutive messages from the same sender
  const shouldShowHeader = (msg, idx) => {
    if (idx === 0) return true;
    const prev = messages[idx - 1];
    if (prev.senderId !== msg.senderId) return true;
    // Show header if gap > 5 minutes
    const gap = new Date(msg.timestamp) - new Date(prev.timestamp);
    return gap > 5 * 60 * 1000;
  };

  return (
    <div className="h-full flex flex-col">
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 px-5 border-b border-[#3c4043] flex-shrink-0">
        <h2 className="text-[17px] font-normal text-[#e8eaed]">In-call messages</h2>
        <div className="flex items-center gap-0.5">
          {messages.length > 0 && (
            <button 
              onClick={downloadCSV}
              className="p-2 text-[#9aa0a6] hover:text-white transition-colors rounded-full hover:bg-white/5"
              title="Download chat history"
            >
              <Download size={18} />
            </button>
          )}
          <button 
            onClick={onClose}
            className="p-2 text-[#9aa0a6] hover:text-white transition-colors rounded-full hover:bg-white/5"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Info Notice */}
      <div className="bg-[#3c4043]/40 mx-4 mt-4 p-3.5 rounded-lg border border-[#5f6368]/20 flex-shrink-0">
        <p className="text-[12px] text-[#9aa0a6] leading-relaxed">
          Messages can only be seen by people in the call and are deleted when the call ends.
        </p>
      </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar scroll-smooth"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <Info size={36} className="mb-4 text-[#8ab4f8] opacity-30" strokeWidth={1.5} />
            <p className="text-[13px] text-[#9aa0a6] opacity-50 leading-relaxed">
              No messages yet.<br/>Send one to start the conversation!
            </p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe = msg.senderId === currentUserId;
            const showHeader = shouldShowHeader(msg, i);
            
            return (
              <div key={i} className={`flex flex-col ${showHeader && i > 0 ? 'mt-4' : ''}`}>
                {showHeader && (
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-medium text-[14px] text-[#e8eaed]">
                      {isMe ? 'You' : msg.senderName}
                    </span>
                    <span className="text-[11px] text-[#9aa0a6]">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
                <div className="text-[14px] text-[#bdc1c6] leading-relaxed break-words whitespace-pre-wrap">
                  {msg.content || msg.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Input Area */}
      <div className="p-4 pt-2 flex-shrink-0">
        <form onSubmit={handleSubmit} className="relative flex items-center">
          <input 
            ref={inputRef}
            type="text" 
            placeholder="Send a message to everyone" 
            className="w-full bg-[#3c4043]/50 border border-[#5f6368]/30 rounded-full px-5 py-3 pr-12 text-[14px] text-white focus:bg-[#3c4043]/80 focus:border-[#8ab4f8]/50 transition-all outline-none placeholder-[#9aa0a6]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button 
            type="submit" 
            disabled={!text.trim()}
            className="absolute right-1.5 p-2 text-[#8ab4f8] disabled:text-[#5f6368] rounded-full hover:bg-white/10 disabled:hover:bg-transparent transition-colors"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
      
    </div>
  );
}
