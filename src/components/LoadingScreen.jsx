import { useState, useEffect } from 'react';

const funMessages = [
  "🎡 Spinning up the Ferris wheel...",
  "🌭 Firing up the grill...",
  "🎪 Setting up the fairgrounds...",
  "🍿 Popping some fresh corn...",
  "🎠 Saddling up the carousel...",
  "🎯 Finding the best deals...",
  "🍦 Whipping up something sweet...",
  "🎉 Getting the party started...",
];

const LoadingScreen = () => {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % funMessages.length);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-bg-dark">
      <div className="text-center px-6">
        <img
          src="/images/image4.png"
          alt="FairDash"
          className="w-28 h-28 mx-auto mb-8 animate-pulse object-contain"
          style={{ filter: 'brightness(1.2)', mixBlendMode: 'screen' }}
        />

        <p className="text-white text-lg font-semibold mb-8 animate-fadeIn min-h-[1.75rem]">
          {funMessages[msgIndex]}
        </p>

        <div className="flex justify-center gap-2">
          <div className="w-3 h-3 bg-neon-pink rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
          <div className="w-3 h-3 bg-neon-pink rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
          <div className="w-3 h-3 bg-neon-pink rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
