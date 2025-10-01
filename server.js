// 📦 Benodigde modules
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
let clients = [];

// ✅ Middleware
app.use(cors({
    origin: [
        'https://qr-bestelpagina.vercel.app',
        'https://bfe5-143-179-158-36.ngrok-free.app',
        'https://bestel-backend.onrender.com',
        'https://adminoa.vercel.app'
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MongoDB verbinden
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Verbonden met MongoDB'))
    .catch(err => console.error('⛔ MongoDB fout:', err));

// ✅ Mongoose modellen

// 🪑 Mongoose model voor kiosken
const Kiosk = mongoose.model('Kiosk', new mongoose.Schema({
    nummer: { type: Number, required: true, unique: true }
}));

const OrderSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    kiosk: { type: Number, required: true }, // ✅ kiosk wordt opgeslagen
    producten: [{
        item: { type: String, required: true },
        quantity: { type: Number, required: true },
        opmerking: { type: String }
    }],
    status: { type: String, default: 'Nieuw' },
    createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', OrderSchema);

const Product = mongoose.model('Product', new mongoose.Schema({
    naam: { type: String, required: true },
    prijs: { type: Number, required: true },
    image: { type: String, default: '' }
}));

// 🔧 Nieuw model voor config (aantal kiosken)
const ConfigSchema = new mongoose.Schema({
    aantalKiosken: { type: Number, required: true, default: 10 }
});
const Config = mongoose.model('Config', ConfigSchema);

// 📡 Server-Sent Events (SSE)
function sendNewOrderNotification(order) {
    const data = {
        orderId: order.orderId,
        producten: order.producten,
        status: order.status,
        kiosk: order.kiosk,
        createdAt: order.createdAt
    };
    clients.forEach(res => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

app.get('/admin/notifications', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);

    req.on('close', () => {
        clients = clients.filter(client => client !== res);
    });
});

// 📬 Bestelling plaatsen
app.post('/order', async (req, res) => {
    const { producten, kiosk } = req.body;

    if (!producten || !Array.isArray(producten) || producten.length === 0) {
        return res.status(400).json({ message: '⛔ Productlijst is verplicht.' });
    }

    if (!kiosk || kiosk < 1) {
        return res.status(400).json({ message: '⛔ Kiosknummer is verplicht.' });
    }

    const orderId = 'ORD-' + Date.now();

    try {
        const order = new Order({ orderId, producten, kiosk });
        await order.save();

        sendNewOrderNotification(order);
        res.json({ message: '✅ Bestelling opgeslagen', order });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij bestelling', error: err.message });
    }
});

// 🔄 Status bijwerken
app.patch('/admin/order/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ message: '⛔ Status is verplicht.' });
    }

    try {
        const order = await Order.findOneAndUpdate(
            { orderId },
            { status },
            { new: true }
        );

        if (!order) return res.status(404).json({ message: '❌ Bestelling niet gevonden.' });

        res.json({ message: '✅ Status geüpdatet', status });
    } catch (err) {
        res.status(500).json({ message: '⛔ Interne fout', error: err.message });
    }
});

// 📋 Admin overzicht (optioneel)
app.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });

        let html = `<table border="1"><tr>
            <th>Order ID</th><th>Kiosk</th><th>Item</th><th>Aantal</th>
            <th>Opmerking</th><th>Tijd</th><th>Status</th>
        </tr>`;

        orders.forEach(order => {
            order.producten.forEach(product => {
                html += `<tr>
                    <td>${order.orderId}</td>
                    <td>${order.kiosk}</td>
                    <td>${product.item}</td>
                    <td>${product.quantity}</td>
                    <td>${product.opmerking || ''}</td>
                    <td>${new Date(order.createdAt).toLocaleString()}</td>
                    <td>${order.status}</td>
                </tr>`;
            });
        });

        html += '</table>';
        res.send(html);
    } catch (err) {
        res.status(500).send('❌ Fout bij ophalen van bestellingen.');
    }
});

// 🆕 NIEUW: Kiosken ophalen
app.get('/admin/kiosken', async (req, res) => {
    try {
        const kiosken = await Kiosk.find().sort({ nummer: 1 });
        res.json(kiosken);
    } catch (err) {
        res.status(500).json({
            message: '⛔ F
:: contentReference[oaicite: 10]{ index=10 }

