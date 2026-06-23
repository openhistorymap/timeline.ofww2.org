import './styles.css';
import { mountWar } from './app';

mountWar(document.getElementById('app')!, {
  key: 'ww2',
  title: 'Timeline of the Second World War',
  subtitle: '1939–1945 · events drawn from Wikidata',
  range: [1939, 1946],
  // Wide enough to scroll back to the war's root cause, the Treaty of Versailles (1919).
  extent: [1918, 1950],
});
