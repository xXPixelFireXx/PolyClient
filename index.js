const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let activeBot = null;
let currentConnectionState = {
    connected: false,
    username: '',
    host: '',
    port: 25565
};

io.on('connection', (socket) => {
    socket.emit('status', currentConnectionState);

    socket.on('connect-server', (data) => {
        const { host, port, username } = data;
        if (activeBot || !host || !username) return;

        currentConnectionState = { connected: false, username, host, port: parseInt(port) || 25565 };
        io.emit('status', currentConnectionState);
        io.emit('chat-message', { sender: 'Server', message: `Connecting to ${host}:${port} as ${username}...` });

        try {
            activeBot = mineflayer.createBot({
                host: currentConnectionState.host,
                port: currentConnectionState.port,
                username: currentConnectionState.username,
                version: '1.21.1'
            });

            activeBot.on('spawn', () => {
                currentConnectionState.connected = true;
                io.emit('status', currentConnectionState);
                io.emit('chat-message', { sender: 'Server', message: 'Successfully joined the server!' });

                // Start the browser 3D world viewer on port 3000 (or integrated route)
                mineflayerViewer(activeBot, { port: 3007, firstPerson: true });
                io.emit('chat-message', { sender: 'Server', message: '3D World Viewer active on port 3007!' });
            });

            // Listen for container/chest openings sent by the server
            activeBot.on('windowOpen', (window) => {
                io.emit('chat-message', { sender: 'Server', message: `Container opened: ${window.title || 'Inventory/Chest'}` });
                // Pass window slots to client interface
                const items = window.slots.map(item => item ? { name: item.name, count: item.count } : null);
                io.emit('inventory-opened', { title: window.title, items });
            });

            activeBot.on('chat', (username, message) => {
                io.emit('chat-message', { sender: username, message: message });
            });

            activeBot.on('messagestr', (message) => {
                io.emit('chat-message', { sender: 'Server', message: message });
            });

            activeBot.on('end', (reason) => {
                io.emit('chat-message', { sender: 'Server', message: `Disconnected: ${reason}` });
                cleanupBot();
            });

        } catch (e) {
            io.emit('chat-message', { sender: 'Server', message: `Failed: ${e.message}` });
            cleanupBot();
        }
    });

    socket.on('send-chat', (message) => {
        if (activeBot && currentConnectionState.connected) {
            activeBot.chat(message);
        }
    });

    socket.on('disconnect-server', () => {
        cleanupBot();
        io.emit('chat-message', { sender: 'Server', message: 'Disconnected by user.' });
    });
});

function cleanupBot() {
    if (activeBot) {
        try { activeBot.end(); } catch(e) {}
        activeBot = null;
    }
    currentConnectionState.connected = false;
    io.emit('status', currentConnectionState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
