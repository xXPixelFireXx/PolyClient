const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const Vec3 = require('vec3');

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

function sendInventoryUpdate() {
    if (!activeBot) return;
    const hotbarSlots = [];
    for (let i = 36; i <= 44; i++) {
        const item = activeBot.inventory.slots[i];
        hotbarSlots.push(item ? { name: item.name, count: item.count, slot: i - 36 } : null);
    }
    io.emit('inventory-update', {
        hotbar: hotbarSlots,
        heldSlot: activeBot.quickBarSlot
    });
}

io.on('connection', (socket) => {
    socket.emit('status', currentConnectionState);
    if (activeBot) sendInventoryUpdate();

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
                version: '1.21.1' // Locked to Minecraft 1.21+ compatibility
            });

            activeBot.on('spawn', () => {
                currentConnectionState.connected = true;
                io.emit('status', currentConnectionState);
                io.emit('chat-message', { sender: 'Server', message: 'Successfully joined the server!' });
                sendInventoryUpdate();
            });

            activeBot.on('chat', (username, message) => {
                io.emit('chat-message', { sender: username, message: message });
            });

            activeBot.on('messagestr', (message) => {
                io.emit('chat-message', { sender: 'Server', message: message });
            });

            activeBot.on('windowUpdate', () => {
                sendInventoryUpdate();
            });

            activeBot.on('end', (reason) => {
                io.emit('chat-message', { sender: 'Server', message: `Disconnected: ${reason}` });
                cleanupBot();
            });

            activeBot.on('error', (err) => {
                io.emit('chat-message', { sender: 'Server', message: `Error: ${err.message}` });
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
            // If it's a command starting with /, label it as Server execution
            const senderName = message.startsWith('/') ? 'Server' : currentConnectionState.username;
            io.emit('chat-message', { sender: senderName, message: message });
        }
    });

    socket.on('select-slot', (slotIndex) => {
        if (activeBot && slotIndex >= 0 && slotIndex <= 8) {
            activeBot.setQuickBarSlot(slotIndex);
            sendInventoryUpdate();
        }
    });

    socket.on('start-using-item', () => { if (activeBot) activeBot.activateItem(); });
    socket.on('stop-using-item', () => { if (activeBot) activeBot.deactivateItem(); });

    socket.on('attack-action', () => {
        if (!activeBot) return;
        const target = activeBot.nearestEntity((entity) => entity.type === 'player' || entity.type === 'mob');
        if (target && activeBot.entity.position.distanceTo(target.position) < 4) {
            activeBot.attack(target);
        } else {
            activeBot.swingArm();
        }
    });

    socket.on('place-block-action', async () => {
        if (!activeBot) return;
        try {
            const referenceBlock = activeBot.blockAtCursor(4) || activeBot.blockAt(activeBot.entity.position.offset(0, -1, 0));
            if (referenceBlock) {
                await activeBot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                io.emit('chat-message', { sender: 'Server', message: 'Placed block successfully!' });
            }
        } catch (err) {
            io.emit('chat-message', { sender: 'Server', message: `Could not place block: ${err.message}` });
        }
    });

    socket.on('start-move', (dir) => { if (activeBot) activeBot.setControlState(dir, true); });
    socket.on('stop-move', (dir) => { if (activeBot) activeBot.setControlState(dir, false); });
    socket.on('jump', () => {
        if (!activeBot) return;
        activeBot.setControlState('jump', true);
        setTimeout(() => activeBot.setControlState('jump', false), 250);
    });

    socket.on('disconnect-server', () => {
        if (activeBot) {
            activeBot.quit();
        }
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
