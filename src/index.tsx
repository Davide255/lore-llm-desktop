import { AppRegistry } from 'react-native';
import 'material-symbols/rounded.css';
import './global.css';
import App from './App';
import { lore } from './kb/bridge';

AppRegistry.registerComponent('LoreLLMDesktop', () => App);
AppRegistry.runApplication('LoreLLMDesktop', { rootTag: document.getElementById('root') });

// Tell the main process the UI is on screen: a live-update bundle that never gets here is dropped (docs/OTA.md).
const confirmStarted = () => {
  if (document.getElementById('root')?.childElementCount) lore.otaReady().catch(() => {});
  else setTimeout(confirmStarted, 250);
};
confirmStarted();
