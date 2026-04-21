import { io } from 'socket.io-client';

const socket = io('https://Sphere-Tinsmith-Thickness.ngrok-free.dev', { 
  path: '/socket.io/', 
  transports: ['websocket', 'polling'] 
});

export default socket;
