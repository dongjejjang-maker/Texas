import { io } from 'socket.io-client';
import { SERVER_URL } from './constants';

const socket = io(SERVER_URL, { 
  path: '/socket.io/', 
  transports: ['websocket', 'polling'] 
});

export default socket;
