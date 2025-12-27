const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const PORT = 8080;

// 1. 创建 HTTP 服务器 (用于健康检查)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('EveryTalk Relay Server is Running.\n');
});

// 2. 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

// 存储房间信息: Map<SessionID, Set<WebSocket>>
const rooms = new Map();

// 辅助函数: 发送 JSON
function sendJson(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

wss.on('connection', (ws, req) => {
    // 3. 解析 URL 参数获取 SessionID (例如: ws://localhost:8080/ws?sid=abc-123)
    const parameters = url.parse(req.url, true);
    const sid = parameters.query.sid;

    if (!sid) {
        console.log('Connection rejected: No session ID (sid) provided.');
        ws.close(1008, 'Session ID required');
        return;
    }

    console.log(`Client connected to session: ${sid}`);

    // 4. 加入房间
    if (!rooms.has(sid)) {
        rooms.set(sid, new Set());
    }
    const room = rooms.get(sid);
    room.add(ws);

    // 发送欢迎消息
    sendJson(ws, { type: 'sys', msg: 'Connected to Relay Server', clients: room.size });

    // 5. 处理消息转发
    ws.on('message', (message) => {
        try {
            // 这里我们假设消息是文本(JSON)或二进制。
            // 为了简单，我们直接透传给房间内 *其他* 客户端。
            // 真实场景下，可以解析 type 字段做一些特殊的路由逻辑，但为了安全和解耦，直接广播最好。

            // console.log(`Relay [${sid}]: ${message.toString().substring(0, 50)}...`);

            room.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            });

        } catch (e) {
            console.error('Error forwarding message:', e);
        }
    });

    // 6. 处理断开连接
    ws.on('close', () => {
        console.log(`Client disconnected from session: ${sid}`);
        if (rooms.has(sid)) {
            const room = rooms.get(sid);
            room.delete(ws);

            // 通知房间内其他人
            room.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    sendJson(client, { type: 'sys', event: 'peer_disconnected' });
                }
            });

            // 房间空了就清理
            if (room.size === 0) {
                rooms.delete(sid);
                console.log(`Session ${sid} is empty and cleared.`);
            }
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error in session ${sid}:`, err);
    });
});

// 7. 启动服务器
server.listen(PORT, () => {
    console.log(`\n=== EveryTalk Relay Server ===`);
    console.log(`Listening on port ${PORT}`);
    console.log(`WebSocket URL: ws://localhost:${PORT}?sid=YOUR_SESSION_ID`);
    console.log(`==============================\n`);
});