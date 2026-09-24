import { AppRegistry } from 'react-native';
import 'material-symbols/rounded.css';
import './global.css';
import App from './App';

AppRegistry.registerComponent('LoreLLMDesktop', () => App);
AppRegistry.runApplication('LoreLLMDesktop', { rootTag: document.getElementById('root') });
