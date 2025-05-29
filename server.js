const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const path = require('path');
const cors = require('cors');

const app = express();

// SSE clients array
let clients = [];

// CORS configuratie
app.use(cors({
    origin: [
        'https://qr-bestelpagina.vercel.app',
        'https://bfe5-143-179-158-36.ngrok-free.app',
        'https://bestel-backend.onrender.com',
        'https://admin-page-psi-ten.vercel.app' // ⬅️ Voeg dit toe
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB verbinding
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Verbonden met MongoDB'))
    .catch(err => console.log('⛔ MongoDB fout:', err));

// Mongoose model
const Order = mongoose.model('Order', new mongoose.Schema({
    orderId: { type: String, required: true },
    item: { type: String, required: true },
    quantity: { type: Number, required: true },
    opmerking: { type: String },
    createdAt: { type: Date, default: Date.now }
}));

// Functie om SSE notificatie te sturen
function sendNewOrderNotification(order) {
    console.log('🔔 SSE notificatie aan', clients.length, 'clients');
    clients.forEach(res => {
        res.write(`data: ${JSON.stringify(order)}\n\n`);
    });
}

// SSE route voor admin
app.get('/admin/notifications', (req, res) => {
    console.log('🔄 Verzoek ontvangen op /admin/notifications');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);
    console.log('✅ Nieuwe SSE client verbonden. Totaal clients:', clients.length);

    req.on('close', () => {
        clients = clients.filter(client => client !== res);
        console.log('❌ SSE client verbroken. Huidige aantal:', clients.length);
    });
});

// Bestelling plaatsen
app.post('/order', async (req, res) => {
    console.log('📥 Nieuw bestelling ontvangen:', req.body);

    const { item, quantity, opmerking } = req.body;

    if (!item || !quantity) {
        console.log('⚠️ Bestelling geweigerd – ontbrekende velden.');
        return res.status(400).json({ message: '⛔ Item en quantity zijn verplicht.' });
    }

    const orderId = 'ORD-' + Date.now();

    try {
        const order = new Order({ orderId, item, quantity, opmerking });
        await order.save();
        console.log('✅ Bestelling opgeslagen in database:', orderId);

        sendNewOrderNotification({
            orderId,
            item,
            quantity,
            opmerking,
            createdAt: order.createdAt
        });

        res.json({
            message: '✅ Bestelling succesvol opgeslagen!',
            orderId,
            item,
            quantity,
            opmerking
        });
    } catch (error) {
        console.error('❌ Fout bij opslaan bestelling:', error);
        res.status(500).json({ message: '⛔ Fout bij opslaan van bestelling.' });
    }
});

// Admin pagina (optioneel: serveer statisch, of zo)
app.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });

        let html = `
            <html>
            <head>
                <title>Bestellingen</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 10px; border: 1px solid #ccc; text-align: left; }
                    th { background-color: #f4f4f4; }
                </style>
            </head>
            <body>
                <h2>Alle Bestellingen (Live Update)</h2>
                <table id="ordersTable">
                    <tr>
                        <th>Order ID</th>
                        <th>Item</th>
                        <th>Aantal</th>
                        <th>Opmerking</th>
                        <th>Tijd</th>
                    </tr>`;

        orders.forEach(order => {
            html += `
                <tr>
                    <td>${order.orderId}</td>
                    <td>${order.item}</td>
                    <td>${order.quantity}</td>
                    <td>${order.opmerking || ''}</td>
                    <td>${new Date(order.createdAt).toLocaleString('nl-NL')}</td>
                </tr>`;
        });

        html += `
                </table>
                <script>
                    const evtSource = new EventSource('/admin/notifications');

                    evtSource.onopen = () => {
                        console.log('✅ SSE verbinding geopend');
                    };

                    evtSource.onerror = (e) => {
                        console.error('❌ SSE fout:', e);
                    };

                    evtSource.onmessage = function(event) {
                        const order = JSON.parse(event.data);
                        const row = document.createElement('tr');
                        row.innerHTML = \`
                            <td>\${order.orderId}</td>
                            <td>\${order.item}</td>
                            <td>\${order.quantity}</td>
                            <td>\${order.opmerking || ''}</td>
                            <td>\${new Date(order.createdAt).toLocaleString('nl-NL')}</td>
                        \`;
                        document.getElementById('ordersTable').appendChild(row);
                    };
                </script>
            </body>
            </html>`;

        res.send(html);
    } catch (error) {
        console.error(error);
        res.status(500).send('❌ Fout bij ophalen van bestellingen.');
    }
});

// Start server
const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`🚀 Server draait op http://localhost:${port}`);
});