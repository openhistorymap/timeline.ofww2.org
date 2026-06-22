import './styles.css';
import { mountWar } from './app';

mountWar(document.getElementById('app')!, {
  key: 'ww2',
  title: 'Timeline of the Second World War',
  subtitle: '1939–1945 · events drawn from Wikidata',
  range: [1939, 1946],
  extent: [1935, 1950],
});
