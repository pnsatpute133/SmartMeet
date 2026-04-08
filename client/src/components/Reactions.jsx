import { useEffect, useState, useCallback } from 'react';

const EMOJIS = ['👍', '❤️', '😂', '👏', '🎉', '🤔', '😲', '😢'];

export default function Reactions({ socket }) {
  const [reactions, setReactions] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const handleReceiveReaction = (data) => {
      const newReaction = {
        id: Math.random().toString(36).substr(2, 9),
        emoji: data.emoji,
        x: Math.random() * 60 + 20, // Keep in center-ish 60%
      };
      
      setReactions(prev => [...prev, newReaction]);

      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== newReaction.id));
      }, 4000); // Life for animation
    };

    socket.on('receive-reaction', handleReceiveReaction);

    return () => {
      socket.off('receive-reaction', handleReceiveReaction);
    };
  }, [socket]);

  const sendReaction = useCallback((emoji) => {
    if (socket) {
      socket.emit('send-reaction', { emoji });
    }
  }, [socket]);

  // Expose sendReaction if needed via ref or a shared context, 
  // but for now we'll handle internal menu display if needed.
  // Actually, we'll let the parent call this if it's rendered as a hidden layer.

  return (
    <>
      {/* Floating Reactions overlay */}
      <div className="absolute inset-0 pointer-events-none z-[100] overflow-hidden">
        {reactions.map((r) => (
          <div 
            key={r.id}
            className="absolute bottom-24 text-4xl select-none animate-float-up"
            style={{ 
              left: `${r.x}%`, 
              animationDuration: `${3 + Math.random()}s`,
              animationTimingFunction: 'ease-out'
            }}
          >
            {r.emoji}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes floatUp {
          0% { 
            transform: translateY(0) scale(1) rotate(0deg); 
            opacity: 1; 
          }
          20% {
            transform: translateY(-50px) scale(1.2) rotate(10deg);
            opacity: 1;
          }
          100% { 
            transform: translateY(-600px) scale(1.5) rotate(-10deg); 
            opacity: 0; 
          }
        }
        .animate-float-up {
          animation: floatUp 4s forwards;
        }
      `}</style>
    </>
  );
}
