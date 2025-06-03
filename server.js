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
        'https://admin-page-psi-ten.vercel.app'
    ],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB verbinding
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Verbonden met MongoDB'))
    .catch(err => console.log('⛔ MongoDB fout:', err));

// Order model
const Order = mongoose.model('Order', new mongoose.Schema({
    orderId: { type: String, required: true },
    item: { type: String, required: true },
    quantity: { type: Number, required: true },
    opmerking: { type: String },
    status: { type: String, default: 'Nieuw' },
    createdAt: { type: Date, default: Date.now }
}));

// Product model
const Product = mongoose.model('Product', new mongoose.Schema({
    naam: { type: String, required: true },
    prijs: { type: Number, required: true },
    image: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}));

// SSE notificatie functie
function sendNewOrderNotification(order) {
    console.log('🔔 SSE notificatie aan', clients.length, 'clients');
    clients.forEach(res => {
        res.write(`data: ${JSON.stringify(order)}\n\n`);
    });
}

// SSE endpoint voor admin live updates
app.get('/admin/notifications', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);
    console.log('✅ SSE client verbonden. Totaal:', clients.length);

    req.on('close', () => {
        clients = clients.filter(client => client !== res);
        console.log('❌ SSE client verbroken. Resterend:', clients.length);
    });
});

// POST: Bestelling plaatsen
app.post('/order', async (req, res) => {
    const { item, quantity, opmerking } = req.body;

    if (!item || !quantity) {
        return res.status(400).json({ message: '⛔ Item en quantity zijn verplicht.' });
    }

    const orderId = 'ORD-' + Date.now();

    try {
        const order = new Order({ orderId, item, quantity, opmerking });
        await order.save();

        sendNewOrderNotification({
            orderId,
            item,
            quantity,
            opmerking,
            createdAt: order.createdAt,
            status: order.status
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

// PATCH: Status van bestelling aanpassen
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

        if (!order) {
            return res.status(404).json({ message: '❌ Bestelling niet gevonden.' });
        }

        console.log(`🔄 Status van ${orderId} aangepast naar: ${status}`);
        res.json({ message: '✅ Status geüpdatet', status });
    } catch (err) {
        console.error('❌ Fout bij status update:', err);
        res.status(500).json({ message: '⛔ Interne serverfout' });
    }
});

// GET: Alle bestellingen (HTML-tabel)
app.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });

        let html = `
            <table>
                <tr>
                    <th>Order ID</th>
                    <th>Item</th>
                    <th>Aantal</th>
                    <th>Opmerking</th>
                    <th>Tijd</th>
                    <th>Status</th>
                </tr>
        `;

        orders.forEach(order => {
            html += `
                <tr>
                    <td>${order.orderId}</td>
                    <td>${order.item}</td>
                    <td>${order.quantity}</td>
                    <td>${order.opmerking || ''}</td>
                    <td>${new Date(order.createdAt).toISOString()}</td>
                    <td>${order.status || 'Nieuw'}</td>
                </tr>`;
        });

        html += '</table>';
        res.send(html);
    } catch (err) {
        res.status(500).send('❌ Fout bij ophalen van bestellingen.');
    }
});

// ✅ NIEUW: GET /products - alle producten ophalen
app.get('/products', async (req, res) => {
    try {
        const producten = await Product.find().sort({ createdAt: -1 });
        res.json(producten);
    } catch (error) {
        console.error('❌ Fout bij ophalen van producten:', error);
        res.status(500).json({ message: '⛔ Fout bij ophalen van producten.' });
    }
});

// ✅ NIEUW: POST /products - nieuw product toevoegen
app.post('/products', async (req, res) => {
    const { naam, prijs, image } = req.body;

    if (!naam || !prijs || !image) {
        return res.status(400).json({ message: '⛔ Naam, prijs en image zijn verplicht.' });
    }

    try {
        const product = new Product({ naam, prijs, image });
        await product.save();
        res.json({ message: '✅ Product succesvol toegevoegd!', product });
    } catch (error) {
        console.error('❌ Fout bij toevoegen product:', error);
        res.status(500).json({ message: '⛔ Fout bij opslaan van product.' });
    }
});

// Server starten
const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`🚀 Server draait op http://localhost:${port}`);
});