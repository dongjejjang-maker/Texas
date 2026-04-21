import React from 'react';

const PlayingCard = ({ card, hidden = false, className = "", style = {} }) => {
  if (!card && !hidden) return null;

  const parseCard = (cardStr) => {
    if (!cardStr) return { suit: '', rank: '', red: false };
    const suit = cardStr.charAt(0);
    const rank = cardStr.substring(1);
    return { suit, rank, red: (suit === '♥' || suit === '♦') };
  };

  const { suit, rank, red } = parseCard(card);
  const color = red ? '#ef4444' : '#000000';

  if (hidden) {
    return <div className={`card-back hidden-card ${className}`} style={style}></div>;
  }

  return (
    <div className={`playing-card-wrapper ${className}`} style={{ position: 'relative', width: '60px', height: '90px', ...style }}>
      <div style={{ 
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
        backgroundColor: '#fff', borderRadius: '6px', overflow: 'hidden', 
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)', color 
      }}>
        <div style={{ position: 'absolute', top: '5px', left: '6px', fontSize: '23px', fontWeight: 'bold', lineHeight: 0.9 }}>
          {rank}
        </div>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '40px', textShadow: '1px 1px 2px rgba(0,0,0,0.1)' }}>
          {suit}
        </div>
      </div>
    </div>
  );
};

export default PlayingCard;
