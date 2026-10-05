import type { EventCategory, Consensus } from '../types';

export interface CategoryMeta {
  label: string;
  color: string; // CSS color used for markers, chips and ticks
  icon: string;  // emoji glyph for quick recognition
}

export const CATEGORIES: Record<EventCategory, CategoryMeta> = {
  cosmic:            { label: 'Cosmic',           color: '#b388ff', icon: '☄️' },
  geology:           { label: 'Geology',          color: '#c08457', icon: '⛰️' },
  climate:           { label: 'Climate',          color: '#4fc3f7', icon: '🌡️' },
  life:              { label: 'Life',             color: '#66bb6a', icon: '🧬' },
  extinction:        { label: 'Extinction',       color: '#ef5350', icon: '💀' },
  'human-evolution': { label: 'Human evolution',  color: '#ffb74d', icon: '🦴' },
  civilization:      { label: 'Civilization',     color: '#ffd54f', icon: '🏛️' },
  empire:            { label: 'Empires & states', color: '#f06292', icon: '👑' },
  war:               { label: 'War',              color: '#e53935', icon: '⚔️' },
  politics:          { label: 'Politics',         color: '#90a4ae', icon: '📜' },
  religion:          { label: 'Religion & ideas', color: '#ce93d8', icon: '🕊️' },
  science:           { label: 'Science',          color: '#64b5f6', icon: '🔭' },
  technology:        { label: 'Technology',       color: '#4db6ac', icon: '⚙️' },
  exploration:       { label: 'Exploration',      color: '#26c6da', icon: '🧭' },
  culture:           { label: 'Culture',          color: '#ff8a65', icon: '🎨' },
  economy:           { label: 'Economy',          color: '#a5d6a7', icon: '💰' },
  disaster:          { label: 'Disaster',         color: '#ff7043', icon: '🌋' },
  fringe:            { label: 'Fringe theory',    color: '#9e9e9e', icon: '❓' },
};

export const CONSENSUS_META: Record<Consensus, { label: string; color: string; hint: string }> = {
  established: { label: 'Established', color: '#66bb6a', hint: 'Textbook consensus.' },
  majority:    { label: 'Mainstream',  color: '#8bc34a', hint: 'Mainstream view; some uncertainty in details or dating.' },
  debated:     { label: 'Debated',     color: '#ffb300', hint: 'Genuinely contested among experts.' },
  fringe:      { label: 'Fringe theory', color: '#9e9e9e', hint: 'Rejected by mainstream scholarship. Shown for interest, clearly labelled.' },
};
